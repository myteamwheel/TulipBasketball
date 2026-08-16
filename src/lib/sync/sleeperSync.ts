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
  leagueId: string; // internal League.id
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

/** Phase 1: pure network I/O, no DB writes. Safe to run outside a transaction. */
async function fetchSleeperData(): Promise<FetchedSleeperData> {
  const [sleeperLeague, users, rosters, nflState, catalog] = await Promise.all([
    getLeague(SLEEPER_LEAGUE_ID),
    getUsers(SLEEPER_LEAGUE_ID),
    getRosters(SLEEPER_LEAGUE_ID),
    getNflState(),
    getPlayerCatalog(),
  ]);

  const throughWeek = Math.max(1, Math.min(nflState.week || 1, 18));
  const transactions = await getAllTransactions(SLEEPER_LEAGUE_ID, throughWeek);
  const completedTransactions = transactions.filter((t) => t.status === "complete");

  return { sleeperLeague, users, rosters, nflState, catalog, completedTransactions };
}

/** Phase 2: pure DB writes. Called inside a single transaction so a failure rolls back cleanly. */
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

  // --- Managers ------------------------------------------------------
  const managerByRosterId = new Map<number, { id: string }>();
  for (const roster of rosters) {
    if (roster.owner_id == null) continue; // orphaned roster, skip
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

  // --- Players (union of all rostered players) ------------------------
  const rosteredPlayerIds = new Set<string>();
  for (const roster of rosters) {
    for (const pid of roster.players ?? []) rosteredPlayerIds.add(pid);
  }

  const mappingWarnings: SleeperSyncResult["mappingWarnings"] = [];
  const playerInternalId = new Map<string, string>(); // sleeperId -> Player.id

  for (const sleeperId of rosteredPlayerIds) {
    const meta = catalog[sleeperId];
    const fullName =
      meta?.full_name ?? ([meta?.first_name, meta?.last_name].filter(Boolean).join(" ") || sleeperId);
    const position = meta?.position ?? "UNK";
    // Note: `update` never touches ktcId/mappingStatus, so the returned
    // player's ktcId reflects prior state — no need for a separate read.
    const player = await db.player.upsert({
      where: { sleeperId },
      update: {
        fullName,
        normalizedName: normalizePlayerName(fullName),
        position,
        nflTeam: meta?.team ?? null,
        status: meta?.injury_status ?? meta?.status ?? null,
      },
      create: {
        sleeperId,
        fullName,
        normalizedName: normalizePlayerName(fullName),
        position,
        nflTeam: meta?.team ?? null,
        status: meta?.injury_status ?? meta?.status ?? null,
        mappingStatus: "NEEDS_REVIEW",
      },
    });
    playerInternalId.set(sleeperId, player.id);

    if (!player.ktcId && player.mappingStatus !== "MAPPED") {
      mappingWarnings.push({
        sleeperId,
        name: fullName,
        reason: "No KTC mapping yet — the automatic KTC step will attempt to resolve it in this refresh.",
      });
    }
  }

  // --- Roster snapshots (audit trail for this refresh run) ------------
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
  if (snapshotRows.length > 0) {
    await db.rosterSnapshot.createMany({ data: snapshotRows });
  }

  // --- Transactions -----------------------------------------------------
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

  // --- Ownership intervals ----------------------------------------------
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

  // Include every open interval in the league, including players who were
  // dropped and therefore are no longer in the current rostered-player union.
  const openIntervals = await db.ownershipInterval.findMany({
    where: { manager: { leagueId: league.id }, validTo: null },
    include: { player: { select: { sleeperId: true } } },
  });
  const openIntervalBySleeperPid = new Map(openIntervals.map((oi) => [oi.player.sleeperId, oi]));

  for (const [sleeperPid, openInterval] of openIntervalBySleeperPid.entries()) {
    const currentRosterId = currentOwnerBySleeperPid.get(sleeperPid);
    const currentManager = currentRosterId != null ? managerByRosterId.get(currentRosterId) : undefined;
    if (currentManager?.id === openInterval.managerId) continue;

    const eventTs = Math.max(latestAddTimestamp.get(sleeperPid) ?? 0, latestDropTimestamp.get(sleeperPid) ?? 0);
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

/**
 * Reconciles live Sleeper league state (metadata, users, rosters, players,
 * transactions) into the database. Network fetches happen first; all writes
 * happen in a single transaction so a mid-sync failure leaves the prior
 * successful state completely untouched instead of partially applied.
 */
export async function syncSleeperState(refreshRunId: string): Promise<SleeperSyncResult> {
  const data = await fetchSleeperData();
  return prisma.$transaction((tx) => persistSleeperData(tx, data, refreshRunId), {
    // Remote Postgres round-trip latency makes ~2000 sequential statements
    // (managers, players, roster snapshots, transactions, ownership
    // intervals) slower than local SQLite; give it real headroom.
    timeout: 180_000,
  });
}
