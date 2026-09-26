import { AuditNotFoundError, isAuditSelector } from "@/lib/auditSelection";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getFullAudit } from "@/lib/fullAudit";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import {
  getAllCurrentRosterEntries,
  getAllManagers,
  getPrimaryManager,
} from "@/lib/queries";
import {
  computeAllTeamValuations,
  getLatestSlotMap,
} from "@/lib/teamMetrics";
import { getProjectionDashboardData } from "@/lib/weeklyProjection";

export type AuditRosterPlayer = {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  status: string | null;
  slot: string;
  value: number | null;
  change7d: number | null;
  change30d: number | null;
  observedAt: string | null;
};

export type AuditTeam = {
  managerId: string;
  teamName: string;
  totalDynastyValue: number;
  playerCapital: number;
  draftCapital: number;
  optimalLineupValue: number;
  depthValue: number;
  playerCount: number;
  valuedPlayerCount: number;
  missingValueCount: number;
  draftPickCount: number;
  capitalComplete: boolean;
  totalRank: number;
  playerRank: number;
  draftRank: number;
  lineupRank: number;
  depthRank: number;
  positionalValue: Record<string, number>;
  positionalStarterValue: Record<string, number>;
  positionalDepthValue: Record<string, number>;
  positionRanks: Record<string, number>;
  change7d: number | null;
  change30d: number | null;
};

export type AuditChange = {
  category: "CAPITAL" | "RANK" | "ROSTER" | "PICKS" | "PROJECTION" | "HEALTH";
  tone: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "WARNING";
  title: string;
  detail: string;
  magnitude: number;
};

export type AuditActivityRow = {
  season: number;
  trades: number;
  waiverClaims: number;
  freeAgentAdds: number;
  drops: number;
};

export type AuditSnapshotData = {
  version: "orlando-audit-v1";
  snapshotId?: string;
  snapshotDate: string;
  generatedAt: string;
  refreshRunId: string | null;
  leagueName: string;
  leagueSeason: string;
  team: AuditTeam;
  league: AuditTeam[];
  roster: AuditRosterPlayer[];
  picks: Array<{
    id: string;
    season: number;
    round: number;
    originTeamName: string;
    label: string;
    value: number;
    projectedSlot: number;
  }>;
  activity: AuditActivityRow[];
  projection: {
    season: number;
    week: number;
    projected: number;
    withheld: number;
    classified: number;
    rosteredSkillPlayers: number;
    coverage: number;
    orlandoProjectedPoints: number | null;
  };
  health: {
    latestRefreshStatus: string | null;
    latestRefreshAt: string | null;
    rosteredPlayers: number;
    valuedPlayers: number;
    projectionReady: boolean;
    auditValidated: boolean;
  };
  recommendations: Array<{
    kind: "KEEP" | "CHANGE" | "WATCH";
    title: string;
    detail: string;
  }>;
  changes: AuditChange[];
};

export type AuditSnapshotSummary = {
  snapshotId?: string;
  snapshotDate: string;
  generatedAt: string;
  refreshRunId: string | null;
  teamValue: number;
  teamRank: number;
  playerCapital: number;
  draftCapital: number;
  lineupValue: number;
  lineupRank: number;
  changeCount: number;
};

type StoredAuditRow = {
  snapshotDate: Date | string;
  generatedAt: Date | string;
  refreshRunId: string | null;
  data: AuditSnapshotData | string;
};

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

function easternDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function parseData(value: AuditSnapshotData | string): AuditSnapshotData {
  return typeof value === "string"
    ? (JSON.parse(value) as AuditSnapshotData)
    : value;
}

function rankMap(
  rows: Awaited<ReturnType<typeof computeAllTeamValuations>>,
  key:
    | "totalDynastyValue"
    | "playerCapital"
    | "draftCapital"
    | "optimalLineupValue"
    | "depthValue",
) {
  return new Map(
    [...rows]
      .sort((a, b) => b[key] - a[key])
      .map((row, index) => [row.managerId, index + 1]),
  );
}

function teamRows(
  rows: Awaited<ReturnType<typeof computeAllTeamValuations>>,
): AuditTeam[] {
  const ranks = {
    total: rankMap(rows, "totalDynastyValue"),
    player: rankMap(rows, "playerCapital"),
    draft: rankMap(rows, "draftCapital"),
    lineup: rankMap(rows, "optimalLineupValue"),
    depth: rankMap(rows, "depthValue"),
  };
  const positionRanks = new Map<string, Map<string, number>>();
  for (const position of POSITIONS) {
    positionRanks.set(
      position,
      new Map(
        [...rows]
          .sort(
            (a, b) =>
              (b.positionalStarterValue[position] ?? 0) -
              (a.positionalStarterValue[position] ?? 0),
          )
          .map((row, index) => [row.managerId, index + 1]),
      ),
    );
  }
  return rows
    .map((row) => ({
      managerId: row.managerId,
      teamName: row.teamName,
      totalDynastyValue: row.totalDynastyValue,
      playerCapital: row.playerCapital,
      draftCapital: row.draftCapital,
      optimalLineupValue: row.optimalLineupValue,
      depthValue: row.depthValue,
      playerCount: row.playerCount,
      valuedPlayerCount: row.valuedPlayerCount,
      missingValueCount: row.missingValueCount,
      draftPickCount: row.draftPickCount,
      capitalComplete: row.capitalComplete,
      totalRank: ranks.total.get(row.managerId) ?? rows.length,
      playerRank: ranks.player.get(row.managerId) ?? rows.length,
      draftRank: ranks.draft.get(row.managerId) ?? rows.length,
      lineupRank: ranks.lineup.get(row.managerId) ?? rows.length,
      depthRank: ranks.depth.get(row.managerId) ?? rows.length,
      positionalValue: row.positionalValue,
      positionalStarterValue: row.positionalStarterValue,
      positionalDepthValue: row.positionalDepthValue,
      positionRanks: Object.fromEntries(
        POSITIONS.map((position) => [
          position,
          positionRanks.get(position)?.get(row.managerId) ?? rows.length,
        ]),
      ),
      change7d: row.change7d,
      change30d: row.change30d,
    }))
    .sort((a, b) => a.totalRank - b.totalRank);
}

function auditChanges(
  current: Omit<AuditSnapshotData, "changes">,
  previous: AuditSnapshotData | null,
): AuditChange[] {
  if (!previous) {
    return [
      {
        category: "HEALTH",
        tone: "NEUTRAL",
        title: "Baseline audit snapshot created",
        detail: `Orlando Oswalds and all ${current.league.length} league teams are now tracked from this date forward.`,
        magnitude: 0,
      },
    ];
  }
  const changes: AuditChange[] = [];
  const capitalDelta =
    current.team.totalDynastyValue - previous.team.totalDynastyValue;
  if (capitalDelta !== 0) {
    changes.push({
      category: "CAPITAL",
      tone: capitalDelta > 0 ? "POSITIVE" : "NEGATIVE",
      title: `Total dynasty capital ${capitalDelta > 0 ? "increased" : "decreased"}`,
      detail: `${capitalDelta > 0 ? "+" : ""}${Math.round(capitalDelta).toLocaleString("en-US")} points since ${previous.snapshotDate}.`,
      magnitude: Math.abs(capitalDelta),
    });
  }
  if (current.team.totalRank !== previous.team.totalRank) {
    const improved = current.team.totalRank < previous.team.totalRank;
    changes.push({
      category: "RANK",
      tone: improved ? "POSITIVE" : "NEGATIVE",
      title: `League capital rank ${improved ? "improved" : "fell"}`,
      detail: `Orlando Oswalds moved from #${previous.team.totalRank} to #${current.team.totalRank}.`,
      magnitude: Math.abs(current.team.totalRank - previous.team.totalRank),
    });
  }
  const priorRoster = new Map(previous.roster.map((row) => [row.playerId, row]));
  const currentRoster = new Map(current.roster.map((row) => [row.playerId, row]));
  const added = current.roster.filter((row) => !priorRoster.has(row.playerId));
  const removed = previous.roster.filter((row) => !currentRoster.has(row.playerId));
  if (added.length || removed.length) {
    const parts = [
      added.length ? `Added: ${added.map((row) => row.name).join(", ")}` : "",
      removed.length
        ? `Removed: ${removed.map((row) => row.name).join(", ")}`
        : "",
    ].filter(Boolean);
    changes.push({
      category: "ROSTER",
      tone: "NEUTRAL",
      title: "Roster composition changed",
      detail: parts.join(". "),
      magnitude: added.length + removed.length,
    });
  }
  const priorPicks = new Map(previous.picks.map((row) => [row.id, row]));
  const currentPicks = new Map(current.picks.map((row) => [row.id, row]));
  const picksAdded = current.picks.filter((row) => !priorPicks.has(row.id));
  const picksRemoved = previous.picks.filter((row) => !currentPicks.has(row.id));
  if (picksAdded.length || picksRemoved.length) {
    changes.push({
      category: "PICKS",
      tone: "NEUTRAL",
      title: "Future-pick portfolio changed",
      detail: `${picksAdded.length} acquired and ${picksRemoved.length} moved since ${previous.snapshotDate}.`,
      magnitude: picksAdded.length + picksRemoved.length,
    });
  }
  const projectionDelta =
    current.projection.orlandoProjectedPoints !== null &&
    previous.projection.orlandoProjectedPoints !== null
      ? current.projection.orlandoProjectedPoints -
        previous.projection.orlandoProjectedPoints
      : null;
  if (projectionDelta !== null && Math.abs(projectionDelta) >= 0.5) {
    changes.push({
      category: "PROJECTION",
      tone: projectionDelta > 0 ? "POSITIVE" : "NEGATIVE",
      title: `Weekly lineup projection ${projectionDelta > 0 ? "rose" : "fell"}`,
      detail: `${projectionDelta > 0 ? "+" : ""}${projectionDelta.toFixed(1)} points since ${previous.snapshotDate}.`,
      magnitude: Math.abs(projectionDelta),
    });
  }
  if (!current.health.projectionReady && previous.health.projectionReady) {
    changes.push({
      category: "HEALTH",
      tone: "WARNING",
      title: "Projection coverage is below the decision-grade gate",
      detail: "Forecast results are withheld until current-week classification recovers.",
      magnitude: 1,
    });
  }
  return changes.sort((a, b) => b.magnitude - a.magnitude);
}

function recommendations(team: AuditTeam) {
  const rows: AuditSnapshotData["recommendations"] = [];
  const weakest = POSITIONS.map((position) => ({
    position,
    rank: team.positionRanks[position] ?? 12,
  })).sort((a, b) => b.rank - a.rank)[0];
  const strongest = POSITIONS.map((position) => ({
    position,
    rank: team.positionRanks[position] ?? 12,
  })).sort((a, b) => a.rank - b.rank)[0];
  rows.push({
    kind: "WATCH",
      title: `Monitor ${weakest.position} depth`,
      detail: `Orlando Oswalds rank #${weakest.rank} in start-eligible ${weakest.position} market strength. Use waivers and trade offers only when they improve the actual lineup or preserve value.`,
  });
  rows.push({
    kind: "KEEP",
    title: `Preserve the ${strongest.position} advantage`,
    detail: `The roster ranks #${strongest.rank} at ${strongest.position}. Avoid turning that strength into several lower-confidence pieces.`,
  });
  if (team.draftRank <= 4) {
    rows.push({
      kind: "KEEP",
      title: "Keep future-pick flexibility",
      detail: `Draft capital ranks #${team.draftRank}. Treat it as optionality rather than spending it to force a short-term move.`,
    });
  } else {
    rows.push({
      kind: "WATCH",
      title: "Rebuild draft flexibility selectively",
      detail: `Draft capital ranks #${team.draftRank}. Prefer adding picks in deals that do not create a new starting-lineup hole.`,
    });
  }
  rows.push({
    kind: "CHANGE",
    title: "Use a higher bar for consolidation trades",
    detail:
      "The historical Orlando Oswalds audit found that consolidation worked poorly when Orlando Oswalds failed to receive the best asset. Require a clear best-player outcome before paying multiple useful pieces.",
  });
  rows.push({
    kind: "KEEP",
    title: "Continue targeting young players and quarterbacks",
    detail:
      "Those were Orlando Oswalds' strongest historical trade patterns in this Superflex league. Recheck price, role and roster fit against the live market before acting.",
  });
  return rows;
}

async function activityForRoster(rosterId: number): Promise<AuditActivityRow[]> {
  const transactions = await prisma.transaction.findMany({
    where: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
    select: {
      type: true,
      sleeperCreatedAt: true,
      rosterIdsInvolved: true,
      drops: true,
    },
    orderBy: { sleeperCreatedAt: "asc" },
  });
  const bySeason = new Map<number, AuditActivityRow>();
  for (const transaction of transactions) {
    let rosterIds: number[] = [];
    try {
      rosterIds = JSON.parse(transaction.rosterIdsInvolved) as number[];
    } catch {}
    if (!rosterIds.map(Number).includes(rosterId)) continue;
    const season = transaction.sleeperCreatedAt.getUTCFullYear();
    const row = bySeason.get(season) ?? {
      season,
      trades: 0,
      waiverClaims: 0,
      freeAgentAdds: 0,
      drops: 0,
    };
    if (transaction.type === "trade") row.trades++;
    else if (transaction.type === "waiver") row.waiverClaims++;
    else if (transaction.type === "free_agent") row.freeAgentAdds++;
    if (transaction.drops) {
      try {
        const drops = JSON.parse(transaction.drops) as Record<string, number>;
        row.drops += Object.values(drops).filter(
          (id) => Number(id) === rosterId,
        ).length;
      } catch {}
    }
    bySeason.set(season, row);
  }
  return [...bySeason.values()].sort((a, b) => a.season - b.season);
}

let auditStorageReady: Promise<void> | undefined;
export function ensureAuditStorage() {
  return auditStorageReady ??= initializeAuditStorage().catch(error => { auditStorageReady = undefined; throw error; });
}
async function initializeAuditStorage() {
  await prisma.$transaction(async tx => {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(817264901)`);
  await tx.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AuditSnapshot" (
      id text PRIMARY KEY,
      "snapshotDate" date NOT NULL,
      "refreshRunId" text,
      "generatedAt" timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'VALIDATED',
      data jsonb NOT NULL,
      "changeSummary" jsonb NOT NULL,
      "modelVersion" text NOT NULL DEFAULT 'orlando-audit-v1'
    )
  `);
  await tx.$executeRawUnsafe(`ALTER TABLE "AuditSnapshot" DROP CONSTRAINT IF EXISTS "AuditSnapshot_snapshotDate_key"`);
  await tx.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AuditSnapshot_generatedAt_idx"
    ON "AuditSnapshot" ("generatedAt" DESC)
  `);
  });
}

async function previousSnapshot() {
  await ensureAuditStorage();
  const rows = await prisma.$queryRawUnsafe<StoredAuditRow[]>(
    `SELECT "snapshotDate", "generatedAt", "refreshRunId", data
     FROM "AuditSnapshot"
     WHERE status = 'VALIDATED' 
     ORDER BY "generatedAt" DESC
     LIMIT 1`,
  );
  return rows[0] ? parseData(rows[0].data) : null;
}

export async function buildLiveAuditData(
  refreshRunId: string | null,
  snapshotDate = easternDate(),
): Promise<AuditSnapshotData> {
  const [managers, entries, primary, valuationRows, slotMap, projection, league] =
    await Promise.all([
      getAllManagers(),
      getAllCurrentRosterEntries(),
      getPrimaryManager(),
      computeAllTeamValuations(),
      getLatestSlotMap(),
      getProjectionDashboardData(),
      prisma.league.findFirst({
        where: { sleeperId: SLEEPER_LEAGUE_ID },
        select: { name: true, season: true },
      }),
    ]);
  if (!primary) throw new Error("Primary Orlando Oswalds manager is unavailable.");
  if (managers.length < 2) throw new Error("League manager coverage is incomplete.");

  const leagueRows = teamRows(valuationRows);
  const team = leagueRows.find((row) => row.managerId === primary.id);
  const valuation = valuationRows.find((row) => row.managerId === primary.id);
  if (!team || !valuation) throw new Error("Orlando Oswalds valuation is unavailable.");

  const ownEntries = entries.filter((entry) => entry.managerId === primary.id);
  if (!ownEntries.length) throw new Error("Orlando Oswalds roster is empty.");
  const market = await computeMarketDataForPlayers(
    ownEntries.map((entry) => entry.playerId),
  );
  const roster: AuditRosterPlayer[] = ownEntries
    .map((entry) => {
      const value = market.get(entry.playerId);
      return {
        playerId: entry.playerId,
        name: entry.player.fullName,
        position: entry.player.position,
        nflTeam: entry.player.nflTeam,
        status: entry.player.status,
        slot: slotMap.get(`${primary.id}:${entry.playerId}`) ?? "BENCH",
        value: value?.currentValue ?? null,
        change7d: value?.change7d?.points ?? null,
        change30d: value?.change30d?.points ?? null,
        observedAt: value?.currentObservedAt ?? null,
      };
    })
    .sort(
      (a, b) =>
        POSITIONS.indexOf(a.position as (typeof POSITIONS)[number]) -
          POSITIONS.indexOf(b.position as (typeof POSITIONS)[number]) ||
        (b.value ?? -1) - (a.value ?? -1),
    );
  const projectedByPlayer = new Map(
    projection.current.map((row) => [row.playerId, row.projectedFantasyPoints]),
  );
  const ownStarters = ownEntries.filter(entry => slotMap.get(`${primary.id}:${entry.playerId}`) === "STARTER");
  const classifiedIds = new Set([...projection.current.map(r => r.playerId), ...projection.unavailable.filter(r => r.status === "EXCLUDED").map(r => r.playerId)]);
  const startersComplete = ownStarters.length > 0 && ownStarters.every(entry => classifiedIds.has(entry.playerId));
  const orlandoProjectedPoints = ownEntries
    .filter(
      (entry) =>
        slotMap.get(`${primary.id}:${entry.playerId}`) === "STARTER" &&
        projectedByPlayer.has(entry.playerId),
    )
    .reduce(
      (sum, entry) => sum + (projectedByPlayer.get(entry.playerId) ?? 0),
      0,
    );
  const rosteredSkillPlayers = entries.filter((entry) =>
    POSITIONS.includes(entry.player.position as (typeof POSITIONS)[number]),
  ).length;
  const classified = new Set([
    ...projection.current.map((row) => row.playerId),
    ...projection.unavailable.map((row) => row.playerId),
  ]).size;
  const coverage = rosteredSkillPlayers ? classified / rosteredSkillPlayers : 0;
  const latestRefresh = await prisma.refreshRun.findFirst({
    where: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
    orderBy: { startedAt: "desc" },
    select: { status: true, startedAt: true },
  });
  const activity = await activityForRoster(primary.sleeperRosterId);
  const previous = await previousSnapshot();
  const withoutChanges: Omit<AuditSnapshotData, "changes"> = {
    version: "orlando-audit-v1",
    snapshotId: randomUUID(),
    snapshotDate,
    generatedAt: new Date().toISOString(),
    refreshRunId,
    leagueName: league?.name ?? "Dynasty Bois",
    leagueSeason: league?.season ?? String(new Date().getUTCFullYear()),
    team,
    league: leagueRows,
    roster,
    picks: valuation.draftPicks.map((pick) => ({
      id: pick.id,
      season: pick.season,
      round: pick.round,
      originTeamName: pick.originTeamName,
      label: pick.label,
      value: pick.value,
      projectedSlot: pick.projectedSlot,
    })),
    activity,
    projection: {
      season: projection.season,
      week: projection.week,
      projected: projection.current.length,
      withheld: projection.unavailable.length,
      classified,
      rosteredSkillPlayers,
      coverage,
      orlandoProjectedPoints:
        coverage >= 0.75 && startersComplete
          ? Math.round(orlandoProjectedPoints * 10) / 10
          : null,
    },
    health: {
      latestRefreshStatus: latestRefresh?.status ?? null,
      latestRefreshAt: latestRefresh?.startedAt.toISOString() ?? null,
      rosteredPlayers: entries.length,
      valuedPlayers: valuationRows.reduce(
        (sum, row) => sum + row.valuedPlayerCount,
        0,
      ),
      projectionReady: coverage >= 0.75,
      auditValidated:
        managers.length === 12 && ownEntries.length > 0 && valuationRows.length === managers.length,
    },
    recommendations: recommendations(team),
  };
  return {
    ...withoutChanges,
    changes: auditChanges(withoutChanges, previous),
  };
}

export async function recordAuditSnapshot(refreshRunId: string | null) {
  await ensureAuditStorage();
  const completed = await prisma.refreshRun.findFirst({
    where: { league: { sleeperId: SLEEPER_LEAGUE_ID }, ...(refreshRunId ? { id: refreshRunId } : {}) },
    orderBy: { startedAt: "desc" },
  });
  if (completed?.status !== "SUCCESS" || !completed?.finishedAt || Date.now() - completed.finishedAt.getTime() > 26 * 3600000) {
    throw new Error("A successful roster, market and pick refresh within 26 hours is required before publishing an audit.");
  }
  const snapshotDate = easternDate();
  const data = await buildLiveAuditData(completed.id, snapshotDate);
  if (!data.health.auditValidated) {
    throw new Error("Audit validation failed; the last good snapshot was retained.");
  }
  if (!data.health.projectionReady) {
    throw new Error(
      "Audit validation failed because current-week projection coverage is below 75%; the last good snapshot was retained.",
    );
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AuditSnapshot"
      (id, "snapshotDate", "refreshRunId", "generatedAt", status, data,
       "changeSummary", "modelVersion")
     VALUES ($1,$2::date,$3,now(),'VALIDATED',$4::jsonb,$5::jsonb,'orlando-audit-v1')
`,
    data.snapshotId!,
    snapshotDate,
    completed.id,
    JSON.stringify(data),
    JSON.stringify(data.changes),
  );
  return data;
}

export async function listAuditSnapshots(): Promise<AuditSnapshotSummary[]> {
  await ensureAuditStorage();
  const rows = await prisma.$queryRawUnsafe<StoredAuditRow[]>(`
    SELECT DISTINCT ON ("snapshotDate") "snapshotDate", "generatedAt", "refreshRunId", data
    FROM "AuditSnapshot"
    WHERE status = 'VALIDATED'
    ORDER BY "snapshotDate" DESC, "generatedAt" DESC
    LIMIT 90
  `);
  return rows.map((row) => {
    const data = parseData(row.data);
    return {
      snapshotId: data.snapshotId,
      snapshotDate: data.snapshotDate,
      generatedAt: data.generatedAt,
      refreshRunId: row.refreshRunId,
      teamValue: data.team.totalDynastyValue,
      teamRank: data.team.totalRank,
      playerCapital: data.team.playerCapital,
      draftCapital: data.team.draftCapital,
      lineupValue: data.team.optimalLineupValue,
      lineupRank: data.team.lineupRank,
      changeCount: data.changes.length,
    };
  });
}

export async function getAuditSnapshot(snapshotDate?: string | null) {
  if (!isAuditSelector(snapshotDate)) throw new AuditNotFoundError("Invalid audit snapshot selector");
  await ensureAuditStorage();
  const rows = snapshotDate
    ? await prisma.$queryRawUnsafe<StoredAuditRow[]>(
        `SELECT "snapshotDate", "generatedAt", "refreshRunId", data
         FROM "AuditSnapshot"
         WHERE status = 'VALIDATED' AND (id = $1 OR "snapshotDate"::text = $1)
         ORDER BY "generatedAt" DESC LIMIT 1`,
        snapshotDate,
      )
    : await prisma.$queryRawUnsafe<StoredAuditRow[]>(`
        SELECT "snapshotDate", "generatedAt", "refreshRunId", data
        FROM "AuditSnapshot"
        WHERE status = 'VALIDATED'
        ORDER BY "generatedAt" DESC
        LIMIT 1
      `);
  return rows[0] ? parseData(rows[0].data) : null;
}

export async function getAuditDashboardData(snapshotDate?: string | null) {
  const [snapshots, stored] = await Promise.all([
    listAuditSnapshots(),
    getAuditSnapshot(snapshotDate),
  ]);
  if (stored) {
    const full = await getFullAudit().catch(() => null);
    const table = full?.data.tables.find((item) => item.name === "trends_manager_season");
    const historical = (table?.rows ?? []).filter((row) => String(row.league) === "Dynasty Bois" && Number(row.is_me) === 1).map((row) => ({ season: Number(row.season), trades: Number(row.trades ?? 0), waiverClaims: Number(row.waiver_claims ?? 0), freeAgentAdds: Number(row.fa_adds ?? 0), drops: Number(row.drops ?? 0) })).filter((row) => Number.isFinite(row.season));
    const activity = historical.length ? historical.sort((a, b) => b.season - a.season) : stored.activity;
    return { data: { ...stored, activity }, snapshots: snapshots.filter(row => row.generatedAt <= stored.generatedAt), isLivePreview: false };
  }
  if (snapshotDate) throw new AuditNotFoundError("Audit snapshot not found");
  const live = await buildLiveAuditData(null, easternDate());
  return { data: live, snapshots, isLivePreview: true };
}
