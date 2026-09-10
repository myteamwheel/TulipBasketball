import { DISPLAY_TIMEZONE, SLEEPER_LEAGUE_ID } from "@/lib/config";
import { prisma } from "@/lib/prisma";

const STATSGUY_RANKINGS_URL = "https://api.statsguyfantasy.com/api/v1/rankings";
const DAY_MS = 86_400_000;
const MIN_PROVIDER_ROWS = 200;
const MIN_MATCHED_ROSTER_ROWS = 200;

type StatsGuyRanking = {
  rank?: number;
  id?: string;
  name?: string;
  team?: string;
  position?: string;
  positionRank?: number;
  value?: number;
  age?: number;
};

type StatsGuyRankingPayload = {
  format?: string;
  asOf?: string;
  total?: number;
  rankings?: StatsGuyRanking[];
};

export type StatsGuyHistoryBackfillRow = {
  targetDate: string;
  asOf: string;
  providerRows: number;
  matchedRosterRows: number;
  storedRows: number;
};

function easternDate(now: Date, offsetDays: number): string {
  const probe = new Date(now.getTime() + offsetDays * DAY_MS);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(probe);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function historicalUrl(date: string): string {
  const url = new URL(STATSGUY_RANKINGS_URL);
  url.searchParams.set("format", "sf_dynasty");
  url.searchParams.set("date", date);
  url.searchParams.set("limit", "1000");
  return url.toString();
}

async function fetchHistoricalBoard(date: string): Promise<{
  asOf: Date;
  sourceUrl: string;
  rankings: StatsGuyRanking[];
}> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid Stats Guy historical date: ${date}`);
  }
  const sourceUrl = historicalUrl(date);
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`Stats Guy historical rankings failed (${response.status}) for ${date}`);
  }
  const payload = (await response.json()) as StatsGuyRankingPayload;
  const rankings = Array.isArray(payload.rankings) ? payload.rankings : [];
  if (rankings.length < MIN_PROVIDER_ROWS) {
    throw new Error(
      `Stats Guy historical board for ${date} returned only ${rankings.length} rows; refusing partial snapshot`,
    );
  }
  const asOf = new Date(payload.asOf ?? "");
  if (!Number.isFinite(asOf.getTime())) {
    throw new Error(`Stats Guy historical board for ${date} did not provide a valid asOf timestamp`);
  }

  // The provider documents historical lookups as the latest snapshot on or
  // before the requested YYYY-MM-DD, with a maximum 14-day lookback. Enforce
  // both promises so a malformed response can never be labeled as that date.
  const asOfDate = asOf.toISOString().slice(0, 10);
  const targetEnd = new Date(`${date}T23:59:59.999Z`);
  if (asOfDate > date || targetEnd.getTime() - asOf.getTime() > 14 * DAY_MS) {
    throw new Error(
      `Stats Guy historical board for ${date} resolved unexpectedly to ${asOf.toISOString()}`,
    );
  }
  return { asOf, sourceUrl, rankings };
}

async function currentRosterPlayers() {
  const ownership = await prisma.ownershipInterval.findMany({
    where: {
      validTo: null,
      manager: { isActive: true, league: { sleeperId: SLEEPER_LEAGUE_ID } },
    },
    include: { player: true },
  });
  const unique = new Map(ownership.map((row) => [row.player.sleeperId, row.player]));
  return unique;
}

/**
 * Self-heal the two most important recent daily market checkpoints. This uses
 * Stats Guy Fantasy's documented historical API (no authentication required),
 * preserves its own source identity, and never writes the values into KTC
 * history. Re-running is idempotent for the same provider snapshot timestamp.
 */
export async function backfillRecentStatsGuyHistory(
  now = new Date(),
): Promise<StatsGuyHistoryBackfillRow[]> {
  const roster = await currentRosterPlayers();
  const dates = [easternDate(now, -1), easternDate(now, 0)];
  const results: StatsGuyHistoryBackfillRow[] = [];
  const seenAsOf = new Set<string>();

  for (const targetDate of dates) {
    const board = await fetchHistoricalBoard(targetDate);
    const asOfIso = board.asOf.toISOString();
    if (seenAsOf.has(asOfIso)) {
      results.push({
        targetDate,
        asOf: asOfIso,
        providerRows: board.rankings.length,
        matchedRosterRows: 0,
        storedRows: 0,
      });
      continue;
    }
    seenAsOf.add(asOfIso);

    const matched = board.rankings.flatMap((ranking) => {
      const sleeperId = String(ranking.id ?? "").trim();
      const player = roster.get(sleeperId);
      const rawValue = Number(ranking.value);
      if (!player || !Number.isFinite(rawValue) || rawValue <= 0 || rawValue > 10_000) {
        return [];
      }
      return [{ player, ranking, rawValue: Math.round(rawValue) }];
    });
    if (matched.length < MIN_MATCHED_ROSTER_ROWS) {
      throw new Error(
        `Stats Guy ${targetDate} matched only ${matched.length} current roster players; refusing weak backfill`,
      );
    }

    const playerIds = matched.map((row) => row.player.id);
    const existing = await prisma.marketObservation.findMany({
      where: {
        source: "STATSGUY",
        observedAt: board.asOf,
        playerId: { in: playerIds },
      },
      select: { playerId: true },
    });
    const existingIds = new Set(existing.map((row) => row.playerId));
    const data = matched
      .filter((row) => !existingIds.has(row.player.id))
      .map(({ player, ranking, rawValue }) => ({
        playerId: player.id,
        source: "STATSGUY" as const,
        rawValue,
        // Stats Guy publishes its own 1-10,000 scale. Historical recovery is
        // intentionally source-native/diagnostic; it is never relabeled as KTC.
        normalizedValue: rawValue,
        observedAt: board.asOf,
        sourceUpdatedAt: board.asOf,
        sourceUrl: board.sourceUrl,
        refreshRunId: null,
        sourceRank: Number.isFinite(Number(ranking.rank)) ? Number(ranking.rank) : null,
        positionRank: Number.isFinite(Number(ranking.positionRank))
          ? Number(ranking.positionRank)
          : null,
        metadata: JSON.stringify({
          historicalSnapshotDate: targetDate,
          providerAsOf: asOfIso,
          attribution: "Stats Guy Fantasy",
          attributionUrl: "https://statsguyfantasy.com/",
          normalization: "source-native diagnostic; not KTC",
        }),
      }));

    if (data.length) await prisma.marketObservation.createMany({ data });
    results.push({
      targetDate,
      asOf: asOfIso,
      providerRows: board.rankings.length,
      matchedRosterRows: matched.length,
      storedRows: data.length,
    });
  }

  return results;
}
