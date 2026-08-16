import { prisma } from "@/lib/prisma";
import { RosterSlot, Prisma } from "@/generated/prisma/client";
import { normalizePlayerName } from "@/lib/normalize";
import {
  getAllTransactions,
  getLeague,
  getNflState,
  getPlayerCatalog,
  getRosters,
  getUsers,
  type SleeperLeague,
  type SleeperNflState,
  type SleeperPlayer,
  type SleeperRoster,
  type SleeperTransaction,
  type SleeperUser,
} from "@/lib/sleeper";
import { ORLANDO_OSWALDS_SLEEPER_USER_ID, SLEEPER_LEAGUE_ID } from "@/lib/config";

export interface SleeperSyncResult {
  leagueId: string;
  rosterChangesCount: number;
  playersRefreshed: number;
  mappingWarnings: { sleeperId: string; name: string; reason: string }[];
  transactionsRecorded: number;
}

type Tx = Prisma.TransactionClient;

interface FetchedSleeperData {
  sleeperLeague: SleeperLeague;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  nflState: SleeperNflState;
  catalog: Record<string, SleeperPlayer>;
  completedTransactions: SleeperTransaction[];
}

function slotFor(roster: SleeperRoster, playerId: string): RosterSlot {
  if (roster.taxi?.includes(playerId)) return RosterSlot.TAXI;
  if (roster.reserve?.includes(playerId)) return RosterSlot.IR;
  if (roster.starters?.includes(playerId)) return RosterSlot.STARTER;
  return RosterSlot.BENCH;
}

/**
 * Current ownership is the critical Sleeper payload. The large /players/nfl
 * catalog and transaction history are useful enrichment, but they are not
 * allowed to block a roster reconciliation. If either auxiliary request fails,
 * current rosters still sync and existing player metadata is preserved.
 */
async function fetchSleeperData(): Promise<FetchedSleeperData> {
  const [sleeperLeague, users, rosters] = await Promise.all([
    getLeague(SLEEPER_LEAGUE_ID),
    getUsers(SLEEPER_LEAGUE_ID),
    getRosters(SLEEPER_LEAGUE_ID),
  ]);

  const nflState = await getNflState().catch(() => ({
    week: 1,
    season: sleeperLeague.season,
    season_type: "unknown",
  } as SleeperNflState));

  const throughWeek = Math.max(1, Math.min(nflState.week || 1, 18));
  const [catalog, transactions] = await Promise.all([
    getPlayerCatalog().catch(() => ({} as Record<string, SleeperPlayer>)),
    getAllTransactions(SLEEPER_LEAGUE_ID, throughWeek).catch(() => [] as SleeperTransaction[]),
  ]);
  const completedTransactions = transactions.filter((t) => t.status === "complete");

  return { sleeperLeague, users, rosters, nflState, catalog, completedTransactions };
}

async function persistSleeperData(
  db: Tx,
  data: FetchedSleeperData,
  refreshRunId: string,
): Promise<SleeperSyncResult> {
  const now = new Date();
  const { sleeperLeague, users, rosters, catalog, completedTransactions } = data;

  const formatParts: string[] = [];
  const rosterPositions = sleeperLeague.roster_positions ?? [];
  const superflexCount = rosterPositions.filter((p) => p === "SUPER_FLEX").length;
  formatParts.push(superflexCount > 0 ? "Superflex" : "1-QB");
  const recPts = sleeperLeague.scoring_settings?.rec ?? 0;
  formatParts.push(`${recPts} PPR`);

  const league = await db.league.upsert({
    where: { sleeperId: sleeperLeague.league_id },
    update: {
      name: sleeperLeague.name,
      season: sleeperLeague.season,
      format: formatParts.join(", "),
      settings: JSON.stringify({
        roster_positions: sleeperLeague.roster_positions,
        scoring_settings: sleeperLeague.scoring_settings,
        settings: sleeperLeague.settings,
        status: sleeperLeague.status,
      }),
    },
    create: {
      sleeperId: sleeperLeague.league_id,
      name: sleeperLeague.name,
      season: sleeperLeague.season,
      format: formatParts.join(", "),
      settings: JSON.stringify({
        roster_positions: sleeperLeague.roster_positions,
        scoring_settings: sleeperLeague.scoring_settings,
        settings: sleeperLeague.settings,
        status: sleeperLeague.status,
      }),
    },
  });

  const usersById = new Map(users.map((u) => [u.user_id, u]));

  await db.manager.updateMany({
    where: { leagueId: league.id },
    data: { isActive: false, isPrimaryTeam: false },
  });

  const managerByRosterId = new Map<number, { id: string }>();
  for (const roster of rosters) {
    if (roster.owner_id == null) continue;
    const user = usersById.get(roster.owner_id);
    const displayName = user?.display_name ?? "Unknown Manager";
    const teamName = user?.metadata?.team_name ?? null;
    const manager = await db.manager.upsert({
      where: { leagueId_sleeperRosterId: { leagueId: league.id, sleeperRosterId: roster.roster_id } },
      update: {
        sleeperUserId: roster.owner_id,
        displayName,
        teamName,
        isPrimaryTeam: roster.owner_id === ORLANDO_OSWALDS_SLEEPER_USER_ID,
        isActive: true,
      },
      create: {
        leagueId: league.id,
        sleeperUserId: roster.owner_id,
        sleeperRosterId: roster.roster_id,
        displayName,
        teamName,
        isPrimaryTeam: roster.owner_id === ORLANDO_OSWALDS_SLEEPER_USER_ID,
      },
    });
    managerByRosterId.set(roster.roster_id, manager);
  }

  const rosteredPlayerIds = new Set<string>();
  for (const roster of rosters) {
    for (const pid of roster.players ?? []) rosteredPlayerIds.add(pid);
  }

  // Preserve known metadata when the optional global player catalog is unavailable.
  const existingPlayers = rosteredPlayerIds.size
    ? await db.player.findMany({ where: { sleeperId: { in: [...rosteredPlayerIds] } } })
    : [];
  const existingBySleeperId = new Map(existingPlayers.map((p) => [p.sleeperId, p]));

  const mappingWarnings: SleeperSyncResult["mappingWarnings"] = [];
  const playerInternalId = new Map<string, string>();

  for (const sleeperId of rosteredPlayerIds) {
    const meta = catalog[sleeperId];
    const existing = existingBySleeperId.get(sleeperId);
    const fullName =
      meta?.full_name ??
      ([meta?.first_name, meta?.last_name].filter(Boolean).join(" ") || existing?.fullName || sleeperId);
    const position = meta?.position ?? existing?.position ?? "UNK";
    const nflTeam = meta ? (meta.team ?? null) : (existing?.nflTeam ?? null);
    const status = meta ? (meta.injury_status ?? meta.status ?? null) : (existing?.status ?? null);

    const player = await db.player.upsert({
      where: { sleeperId },
      update: {
        fullName,
        normalizedName: normalizePlayerName(fullName),
        position,
        nflTeam,
        status,
      },
      create: {
        sleeperId,
        fullName,
        normalizedName: normalizePlayerName(fullName),
        position,
        nflTeam,
        status,
        mappingStatus: "NEEDS_REVIEW",
      },
    });
    playerInternalId.set(sleeperId, player.id);

    if (!player.ktcId && player.mappingStatus !== "MAPPED") {
      mappingWarnings.push({
        sleeperId,
        name: fullName,
        reason: meta
          ? "No KTC mapping yet — the market refresh will attempt to resolve it."
          : "No KTC mapping and Sleeper player metadata was unavailable on this run.",
      });
    }
  }

  const snapshotRows: {
    refreshRunId: string;
    managerId: string;
    playerId: string;
    slot: RosterSlot;
    observedAt: Date;
  }[] = [];
  for (const roster of rosters) {
    const manager = managerByRosterId.get(roster.roster_id);
    if (!manager) continue;
    for (const pid of roster.players ?? []) {
      const playerId = playerInternalId.get(pid);
      if (!playerId) continue;
      snapshotRows.push({
        refreshRunId,
        managerId: manager.id,
        playerId,
        slot: slotFor(roster, pid),
        observedAt: now,
      });
    }
  }
  if (snapshotRows.length > 0) await db.rosterSnapshot.createMany({ data: snapshotRows });

  const transactionRows = completedTransactions.map((t) => ({
    leagueId: league.id,
    sleeperTransactionId: t.transaction_id,
    type: t.type,
    status: t.status,
    sleeperCreatedAt: new Date(t.created),
    rosterIdsInvolved: JSON.stringify(t.roster_ids ?? []),
    adds: t.adds ? JSON.stringify(t.adds) : null,
    drops: t.drops ? JSON.stringify(t.drops) : null,
    draftPicks: t.draft_picks ? JSON.stringify(t.draft_picks) : null,
    waiverBudget: t.waiver_budget ? JSON.stringify(t.waiver_budget) : null,
    rawPayload: JSON.stringify(t),
  }));
  const transactionCreateResult = transactionRows.length
    ? await db.transaction.createMany({ data: transactionRows, skipDuplicates: true })
    : { count: 0 };
  const transactionsRecorded = transactionCreateResult.count;

  const latestAddTimestamp = new Map<string, number>();
  const latestDropTimestamp = new Map<string, number>();
  for (const t of completedTransactions) {
    for (const sleeperPid of Object.keys(t.adds ?? {})) {
      const prevTs = latestAddTimestamp.get(sleeperPid) ?? 0;
      if (t.created > prevTs) latestAddTimestamp.set(sleeperPid, t.created);
    }
    for (const sleeperPid of Object.keys(t.drops ?? {})) {
      const prevTs = latestDropTimestamp.get(sleeperPid) ?? 0;
      if (t.created > prevTs) latestDropTimestamp.set(sleeperPid, t.created);
    }
  }

  let rosterChangesCount = 0;
  const currentOwnerBySleeperPid = new Map<string, number>();
  for (const roster of rosters) {
    for (const pid of roster.players ?? []) currentOwnerBySleeperPid.set(pid, roster.roster_id);
  }

  const openIntervals = await db.ownershipInterval.findMany({
    where: { manager: { leagueId: league.id }, validTo: null },
    include: { player: { select: { sleeperId: true } } },
  });
  const openIntervalBySleeperPid = new Map(openIntervals.map((oi) => [oi.player.sleeperId, oi]));

  for (const [sleeperPid, openInterval] of openIntervalBySleeperPid.entries()) {
    const currentRosterId = currentOwnerBySleeperPid.get(sleeperPid);
    const currentManager = currentRosterId != null ? managerByRosterId.get(currentRosterId) : undefined;
    if (currentManager?.id === openInterval.managerId) continue;

    const eventTs = Math.max(
      latestAddTimestamp.get(sleeperPid) ?? 0,
      latestDropTimestamp.get(sleeperPid) ?? 0,
    );
    await db.ownershipInterval.update({
      where: { id: openInterval.id },
      data: { validTo: eventTs > 0 ? new Date(eventTs) : now },
    });
    rosterChangesCount++;
  }

  for (const [sleeperPid, playerId] of playerInternalId.entries()) {
    const currentRosterId = currentOwnerBySleeperPid.get(sleeperPid);
    const currentManager = currentRosterId != null ? managerByRosterId.get(currentRosterId) : undefined;
    if (!currentManager) continue;

    const priorOpen = openIntervalBySleeperPid.get(sleeperPid);
    if (priorOpen?.managerId === currentManager.id) continue;

    const addTs = latestAddTimestamp.get(sleeperPid) ?? 0;
    await db.ownershipInterval.create({
      data: {
        playerId,
        managerId: currentManager.id,
        validFrom: addTs > 0 ? new Date(addTs) : now,
        validTo: null,
      },
    });
    if (!priorOpen) rosterChangesCount++;
  }

  return {
    leagueId: league.id,
    rosterChangesCount,
    playersRefreshed: rosteredPlayerIds.size,
    mappingWarnings,
    transactionsRecorded,
  };
}

export async function syncSleeperState(refreshRunId: string): Promise<SleeperSyncResult> {
  const data = await fetchSleeperData();
  return prisma.$transaction((tx) => persistSleeperData(tx, data, refreshRunId), {
    timeout: 180_000,
  });
}
