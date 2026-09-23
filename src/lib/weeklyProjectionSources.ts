import { normalizePlayerName } from "@/lib/normalize";

export type ProjectionStatLine = {
  completions: number;
  attempts: number;
  passingYards: number;
  passingTds: number;
  interceptions: number;
  carries: number;
  rushingYards: number;
  rushingTds: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
  fumblesLost: number;
};

export type ProjectionSourceName = "SLEEPER" | "CBS";

export type ExternalWeeklyProjection = {
  source: ProjectionSourceName;
  sleeperId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  fantasyPointsHalfPpr: number;
  stats: ProjectionStatLine;
  fetchedAt: string;
};

export type ProjectionSourceStatus = {
  source: ProjectionSourceName;
  ok: boolean;
  rows: number;
  message: string;
};

type ProjectionPlayer = {
  sleeperId: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
};

const EMPTY_STATS: ProjectionStatLine = {
  completions: 0,
  attempts: 0,
  passingYards: 0,
  passingTds: 0,
  interceptions: 0,
  carries: 0,
  rushingYards: 0,
  rushingTds: 0,
  targets: 0,
  receptions: 0,
  receivingYards: 0,
  receivingTds: 0,
  fumblesLost: 0,
};

const n = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pick = (obj: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return 0;
};

export function halfPprFromStats(stats: ProjectionStatLine) {
  return (
    stats.passingYards / 25 +
    stats.passingTds * 4 -
    stats.interceptions * 2 +
    stats.rushingYards / 10 +
    stats.rushingTds * 6 +
    stats.receptions * 0.5 +
    stats.receivingYards / 10 +
    stats.receivingTds * 6 -
    stats.fumblesLost * 2
  );
}

function sleeperStats(raw: Record<string, unknown>): ProjectionStatLine {
  const stats =
    raw.stats && typeof raw.stats === "object"
      ? (raw.stats as Record<string, unknown>)
      : raw;
  return {
    completions: n(pick(stats, "pass_cmp", "pass_completions", "completions")),
    attempts: n(pick(stats, "pass_att", "pass_attempts", "attempts")),
    passingYards: n(pick(stats, "pass_yd", "pass_yds", "passing_yards")),
    passingTds: n(pick(stats, "pass_td", "pass_tds", "passing_tds")),
    interceptions: n(pick(stats, "pass_int", "interceptions")),
    carries: n(pick(stats, "rush_att", "carries")),
    rushingYards: n(pick(stats, "rush_yd", "rush_yds", "rushing_yards")),
    rushingTds: n(pick(stats, "rush_td", "rush_tds", "rushing_tds")),
    targets: n(pick(stats, "rec_tgt", "targets")),
    receptions: n(pick(stats, "rec", "receptions")),
    receivingYards: n(pick(stats, "rec_yd", "rec_yds", "receiving_yards")),
    receivingTds: n(pick(stats, "rec_td", "rec_tds", "receiving_tds")),
    fumblesLost: n(pick(stats, "fum_lost", "fumbles_lost")),
  };
}

async function fetchSleeper(
  season: number,
  week: number,
  players: ProjectionPlayer[],
): Promise<ExternalWeeklyProjection[]> {
  const response = await fetch(
    `https://api.sleeper.app/v1/projections/nfl/regular/${season}/${week}`,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Sleeper projections failed (${response.status} ${response.statusText})`,
    );
  }

  const payload = (await response.json()) as unknown;
  const bySleeper = new Map(players.map((player) => [player.sleeperId, player]));
  const fetchedAt = new Date().toISOString();
  const rows: ExternalWeeklyProjection[] = [];

  const entries: Array<[string, Record<string, unknown>]> = Array.isArray(payload)
    ? payload
        .map((row) => {
          const object = row as Record<string, unknown>;
          const playerId = String(
            object.player_id ??
              (object.player &&
              typeof object.player === "object" &&
              "player_id" in object.player
                ? (object.player as Record<string, unknown>).player_id
                : ""),
          );
          return [playerId, object] as [string, Record<string, unknown>];
        })
        .filter(([id]) => Boolean(id))
    : payload && typeof payload === "object"
      ? Object.entries(payload as Record<string, unknown>)
          .filter(([, row]) => row && typeof row === "object")
          .map(([id, row]) => [id, row as Record<string, unknown>])
      : [];

  for (const [sleeperId, raw] of entries) {
    const player = bySleeper.get(sleeperId);
    if (!player) continue;
    const stats = sleeperStats(raw);
    const rawStats =
      raw.stats && typeof raw.stats === "object"
        ? (raw.stats as Record<string, unknown>)
        : raw;
    const pointsValue = pick(
      rawStats,
      "pts_half_ppr",
      "pts_half",
      "fantasy_points_half_ppr",
    );
    const points = n(pointsValue) || halfPprFromStats(stats);
    if (!Number.isFinite(points)) continue;
    rows.push({
      source: "SLEEPER",
      sleeperId,
      playerName: player.fullName,
      position: player.position,
      nflTeam: player.nflTeam,
      fantasyPointsHalfPpr: points,
      stats,
      fetchedAt,
    });
  }
  return rows;
}

function decodeHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function numericCell(value: string) {
  const cleaned = value.replace(/,/g, "").replace(/[^0-9.+-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cbsStats(
  position: string,
  numbers: number[],
): ProjectionStatLine | null {
  const stats = { ...EMPTY_STATS };
  if (position === "QB") {
    if (numbers.length < 14) return null;
    stats.attempts = numbers[1] ?? 0;
    stats.completions = numbers[2] ?? 0;
    stats.passingYards = numbers[3] ?? 0;
    stats.passingTds = numbers[5] ?? 0;
    stats.interceptions = numbers[6] ?? 0;
    stats.carries = numbers[8] ?? 0;
    stats.rushingYards = numbers[9] ?? 0;
    stats.rushingTds = numbers[11] ?? 0;
    stats.fumblesLost = numbers[12] ?? 0;
    return stats;
  }
  if (position === "RB") {
    if (numbers.length < 13) return null;
    stats.carries = numbers[1] ?? 0;
    stats.rushingYards = numbers[2] ?? 0;
    stats.rushingTds = numbers[4] ?? 0;
    stats.targets = numbers[5] ?? 0;
    stats.receptions = numbers[6] ?? 0;
    stats.receivingYards = numbers[7] ?? 0;
    stats.receivingTds = numbers[10] ?? 0;
    stats.fumblesLost = numbers[11] ?? 0;
    return stats;
  }
  if (position === "WR" || position === "TE") {
    if (numbers.length < 13) return null;
    stats.targets = numbers[1] ?? 0;
    stats.receptions = numbers[2] ?? 0;
    stats.receivingYards = numbers[3] ?? 0;
    stats.receivingTds = numbers[6] ?? 0;
    stats.carries = numbers[7] ?? 0;
    stats.rushingYards = numbers[8] ?? 0;
    stats.rushingTds = numbers[10] ?? 0;
    stats.fumblesLost = numbers[11] ?? 0;
    return stats;
  }
  return null;
}

async function fetchCbs(
  season: number,
  week: number,
  players: ProjectionPlayer[],
): Promise<ExternalWeeklyProjection[]> {
  const fetchedAt = new Date().toISOString();
  const rows: ExternalWeeklyProjection[] = [];
  const playersByPosition = new Map<string, ProjectionPlayer[]>();
  for (const player of players) {
    const list = playersByPosition.get(player.position) ?? [];
    list.push(player);
    playersByPosition.set(player.position, list);
  }

  for (const position of ["QB", "RB", "WR", "TE"]) {
    const candidates = playersByPosition.get(position) ?? [];
    if (!candidates.length) continue;
    const response = await fetch(
      `https://www.cbssports.com/fantasy/football/stats/${position}/${season}/${week}/projections/ppr/`,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent":
            "Mozilla/5.0 (compatible; DynastyBoysDashboard/1.0; +https://dynasty-boys-dashboard.vercel.app)",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) {
      throw new Error(
        `CBS ${position} projections failed (${response.status} ${response.statusText})`,
      );
    }
    const html = await response.text();
    const trMatches = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    const normalizedCandidates = candidates.map((player) => ({
      player,
      key: normalizePlayerName(player.fullName),
    }));

    for (const tr of trMatches) {
      const cells = [
        ...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi),
      ].map((match) => decodeHtml(match[1]));
      if (cells.length < 5) continue;
      const first = normalizePlayerName(cells[0]);
      const match = normalizedCandidates.find(({ key }) => first.includes(key));
      if (!match) continue;
      const numbers = cells.slice(1).map(numericCell);
      const stats = cbsStats(position, numbers);
      if (!stats) continue;
      const points = halfPprFromStats(stats);
      if (!Number.isFinite(points)) continue;
      rows.push({
        source: "CBS",
        sleeperId: match.player.sleeperId,
        playerName: match.player.fullName,
        position,
        nflTeam: match.player.nflTeam,
        fantasyPointsHalfPpr: points,
        stats,
        fetchedAt,
      });
    }
  }
  return rows;
}

export async function fetchWeeklyProjectionSources(
  season: number,
  week: number,
  players: ProjectionPlayer[],
) {
  const statuses: ProjectionSourceStatus[] = [];
  const collected: ExternalWeeklyProjection[] = [];

  const [sleeperResult, cbsResult] = await Promise.allSettled([
    fetchSleeper(season, week, players),
    fetchCbs(season, week, players),
  ]);

  if (sleeperResult.status === "fulfilled") {
    collected.push(...sleeperResult.value);
    statuses.push({
      source: "SLEEPER",
      ok: true,
      rows: sleeperResult.value.length,
      message: "Sleeper weekly projections loaded",
    });
  } else {
    statuses.push({
      source: "SLEEPER",
      ok: false,
      rows: 0,
      message:
        sleeperResult.reason instanceof Error
          ? sleeperResult.reason.message
          : String(sleeperResult.reason),
    });
  }

  if (cbsResult.status === "fulfilled") {
    collected.push(...cbsResult.value);
    statuses.push({
      source: "CBS",
      ok: true,
      rows: cbsResult.value.length,
      message: "CBS weekly projections loaded",
    });
  } else {
    statuses.push({
      source: "CBS",
      ok: false,
      rows: 0,
      message:
        cbsResult.reason instanceof Error
          ? cbsResult.reason.message
          : String(cbsResult.reason),
    });
  }

  const byPlayer = new Map<string, ExternalWeeklyProjection[]>();
  for (const row of collected) {
    const list = byPlayer.get(row.sleeperId) ?? [];
    list.push(row);
    byPlayer.set(row.sleeperId, list);
  }

  return { byPlayer, statuses };
}
