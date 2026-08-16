import Papa from "papaparse";
import { prisma } from "@/lib/prisma";
import { getNflState, getPlayerCatalog } from "@/lib/sleeper";
import { normalizePlayerName } from "@/lib/normalize";

const NFLVERSE_PLAYERS_URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";
const NFLVERSE_STATS_URL = (season: number) => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
const SLEEPER_STATS_URL = (season: number, week: number, seasonType: string) => `https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=${seasonType}`;

type CsvRow = Record<string, string>;
type AnyObj = Record<string, unknown>;

type LeaguePlayer = {
  id: string;
  sleeperId: string;
  fullName: string;
  normalizedName: string;
  position: string;
  nflTeam: string | null;
};

export interface StoredGameStat {
  id: string;
  playerId: string;
  sleeperId: string;
  gsisId: string | null;
  season: number;
  week: number;
  seasonType: string;
  team: string | null;
  opponent: string | null;
  fantasyHalfPpr: number;
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
  grade: string;
  gradeScore: number;
  performanceSummary: string;
  source: string;
  sourceUpdatedAt: Date | null;
  observedAt: Date;
}

export interface FootballProfile {
  playerId: string;
  sleeperId: string;
  gsisId: string | null;
  displayName: string | null;
  position: string | null;
  draftYear: number | null;
  draftRound: number | null;
  draftPick: number | null;
  draftTeam: string | null;
  college: string | null;
  birthDate: string | null;
}

export interface StoredPerformanceContext {
  profile: FootballProfile | null;
  games: StoredGameStat[];
  latestGame: StoredGameStat | null;
  recentGames: StoredGameStat[];
  recentAverageGrade: number | null;
  recentRegularAverageGrade: number | null;
}

export interface PlayerStatsRefreshResult {
  playersResolved: number;
  profilesStored: number;
  gamesStored: number;
  seasonsFetched: number;
  historicalBackfill: boolean;
  warnings: string[];
}

function n(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}
function maybeInt(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null;
}
function s(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}
function clamp(value: number, min = 0, max = 100): number { return Math.max(min, Math.min(max, value)); }

function gradeFromScore(score: number): string {
  if (score >= 93) return "A+";
  if (score >= 88) return "A";
  if (score >= 84) return "A-";
  if (score >= 80) return "B+";
  if (score >= 76) return "B";
  if (score >= 72) return "B-";
  if (score >= 68) return "C+";
  if (score >= 64) return "C";
  if (score >= 60) return "C-";
  if (score >= 56) return "D+";
  if (score >= 52) return "D";
  if (score >= 48) return "D-";
  return "F";
}

type GameInput = Omit<StoredGameStat, "id" | "playerId" | "sleeperId" | "gsisId" | "grade" | "gradeScore" | "performanceSummary" | "sourceUpdatedAt" | "observedAt" | "source"> & {
  sourceUpdatedAt?: Date | null;
};

function gradeGame(position: string, game: GameInput): { gradeScore: number; grade: string; summary: string } {
  let score = 50;
  const opportunities = game.carries + game.targets;
  if (position === "QB") {
    const completionPct = game.attempts > 0 ? game.completions / game.attempts : 0;
    score += clamp((completionPct - 0.55) * 55, -10, 10);
    score += clamp(game.passingYards / 20, 0, 18);
    score += game.passingTds * 8;
    score -= game.interceptions * 9;
    score += clamp(game.rushingYards / 8, -2, 8);
    score += game.rushingTds * 8;
    score -= game.fumblesLost * 9;
    score += clamp(game.attempts / 6, 0, 7);
  } else {
    score += clamp(opportunities * 1.25, 0, 18);
    score += clamp((game.rushingYards + game.receivingYards) / 8, 0, 20);
    score += (game.rushingTds + game.receivingTds) * 12;
    score += clamp(game.receptions * 0.8, 0, 6);
    score -= game.fumblesLost * 10;
  }
  score = Math.round(clamp(score));
  const grade = gradeFromScore(score);
  const stage = game.seasonType === "PRE" ? "Preseason" : game.seasonType === "POST" ? "Postseason" : "Regular season";
  let statLine: string;
  if (position === "QB") {
    statLine = `${game.completions}/${game.attempts}, ${Math.round(game.passingYards)} pass yds, ${game.passingTds} pass TD, ${game.interceptions} INT`;
    if (game.rushingYards || game.rushingTds) statLine += `; ${Math.round(game.rushingYards)} rush yds${game.rushingTds ? `, ${game.rushingTds} rush TD` : ""}`;
  } else {
    const pieces: string[] = [];
    if (game.carries) pieces.push(`${game.carries} car, ${Math.round(game.rushingYards)} rush yds${game.rushingTds ? `, ${game.rushingTds} TD` : ""}`);
    if (game.targets || game.receptions) pieces.push(`${game.receptions}/${game.targets} rec, ${Math.round(game.receivingYards)} rec yds${game.receivingTds ? `, ${game.receivingTds} TD` : ""}`);
    statLine = pieces.join("; ") || `${game.fantasyHalfPpr.toFixed(1)} half-PPR pts`;
  }
  const context = game.seasonType === "PRE"
    ? "Preseason performance is graded, but carries reduced dynasty-signal weight because roles and opponent quality are less stable."
    : score >= 84 ? "Strong game-level production/efficiency; this supports the player profile but does not override dynasty market context by itself."
      : score < 56 ? "Poor game-level result; the signal model requires a sustained multi-game pattern or corroborating role/market decline before treating it as an exit trigger."
        : "Mixed/ordinary game; useful as one data point rather than a standalone dynasty conclusion.";
  return { gradeScore: score, grade, summary: `${stage} Week ${game.week}: ${statLine}. Grade ${grade} (${score}/100). ${context}` };
}

function participation(game: GameInput): boolean {
  return game.attempts + game.completions + game.carries + game.targets + game.receptions + Math.abs(game.passingYards) + Math.abs(game.rushingYards) + Math.abs(game.receivingYards) + game.passingTds + game.rushingTds + game.receivingTds + game.interceptions + game.fumblesLost > 0;
}

async function currentLeaguePlayers(): Promise<LeaguePlayer[]> {
  const entries = await prisma.ownershipInterval.findMany({ where: { validTo: null }, include: { player: true } });
  return [...new Map(entries.map((e) => [e.player.id, {
    id: e.player.id,
    sleeperId: e.player.sleeperId,
    fullName: e.player.fullName,
    normalizedName: e.player.normalizedName,
    position: e.player.position,
    nflTeam: e.player.nflTeam,
  }])).values()];
}

let playersPromise: Promise<{ rows: CsvRow[]; updatedAt: Date | null }> | null = null;
async function fetchNflversePlayers() {
  if (playersPromise) return playersPromise;
  playersPromise = (async () => {
    const res = await fetch(NFLVERSE_PLAYERS_URL, { cache: "no-store", headers: { Accept: "text/csv" } });
    if (!res.ok) throw new Error(`nflverse players failed (${res.status})`);
    const text = await res.text();
    const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true });
    const updatedAt = new Date(res.headers.get("last-modified") ?? res.headers.get("date") ?? "");
    return { rows: parsed.data, updatedAt: Number.isFinite(updatedAt.getTime()) ? updatedAt : null };
  })();
  return playersPromise;
}

const seasonPromises = new Map<number, Promise<{ rows: CsvRow[]; updatedAt: Date | null }>>();
async function fetchNflverseSeason(season: number) {
  const cached = seasonPromises.get(season);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const res = await fetch(NFLVERSE_STATS_URL(season), { cache: "no-store", headers: { Accept: "text/csv" } });
      if (!res.ok) return { rows: [] as CsvRow[], updatedAt: null };
      const text = await res.text();
      const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true });
      const updatedAt = new Date(res.headers.get("last-modified") ?? res.headers.get("date") ?? "");
      return { rows: parsed.data, updatedAt: Number.isFinite(updatedAt.getTime()) ? updatedAt : null };
    } catch { return { rows: [] as CsvRow[], updatedAt: null }; }
  })();
  seasonPromises.set(season, promise);
  return promise;
}

function sleeperEntries(body: unknown): AnyObj[] {
  if (Array.isArray(body)) return body.filter((x): x is AnyObj => !!x && typeof x === "object");
  if (body && typeof body === "object") return Object.values(body as AnyObj).filter((x): x is AnyObj => !!x && typeof x === "object");
  return [];
}

async function fetchSleeperWeek(season: number, week: number, seasonType: "pre" | "regular" | "post"): Promise<AnyObj[]> {
  try {
    const res = await fetch(SLEEPER_STATS_URL(season, week, seasonType), { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    return sleeperEntries(await res.json());
  } catch { return []; }
}

async function upsertProfile(player: LeaguePlayer, meta: CsvRow | null, gsisId: string | null, sourceUpdatedAt: Date | null) {
  await (prisma as any).$executeRawUnsafe(
    `INSERT INTO "PlayerFootballProfile" ("playerId","sleeperId","gsisId","displayName","position","draftYear","draftRound","draftPick","draftTeam","college","birthDate","sourceUpdatedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) ON CONFLICT ("playerId") DO UPDATE SET "sleeperId"=EXCLUDED."sleeperId","gsisId"=EXCLUDED."gsisId","displayName"=EXCLUDED."displayName","position"=EXCLUDED."position","draftYear"=EXCLUDED."draftYear","draftRound"=EXCLUDED."draftRound","draftPick"=EXCLUDED."draftPick","draftTeam"=EXCLUDED."draftTeam","college"=EXCLUDED."college","birthDate"=EXCLUDED."birthDate","sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt","updatedAt"=NOW()`,
    player.id, player.sleeperId, gsisId, meta?.display_name ?? player.fullName, meta?.position ?? player.position,
    maybeInt(meta?.draft_year), maybeInt(meta?.draft_round), maybeInt(meta?.draft_pick), s(meta?.draft_team), s(meta?.college_name), s(meta?.birth_date), sourceUpdatedAt,
  );
}

async function upsertGame(player: LeaguePlayer, gsisId: string | null, source: string, sourceUpdatedAt: Date | null, raw: unknown, input: GameInput): Promise<boolean> {
  if (!participation(input)) return false;
  const graded = gradeGame(player.position, input);
  const id = `${player.id}:${input.season}:${input.seasonType}:${input.week}`;
  await (prisma as any).$executeRawUnsafe(
    `INSERT INTO "PlayerGameStat" ("id","playerId","sleeperId","gsisId","season","week","seasonType","team","opponent","gameDate","fantasyHalfPpr","completions","attempts","passingYards","passingTds","interceptions","carries","rushingYards","rushingTds","targets","receptions","receivingYards","receivingTds","fumblesLost","grade","gradeScore","performanceSummary","source","sourceUpdatedAt","refreshRunId","rawPayload","observedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,NOW()) ON CONFLICT ("playerId","season","week","seasonType") DO UPDATE SET "gsisId"=EXCLUDED."gsisId","team"=COALESCE(EXCLUDED."team","PlayerGameStat"."team"),"opponent"=COALESCE(EXCLUDED."opponent","PlayerGameStat"."opponent"),"fantasyHalfPpr"=EXCLUDED."fantasyHalfPpr","completions"=EXCLUDED."completions","attempts"=EXCLUDED."attempts","passingYards"=EXCLUDED."passingYards","passingTds"=EXCLUDED."passingTds","interceptions"=EXCLUDED."interceptions","carries"=EXCLUDED."carries","rushingYards"=EXCLUDED."rushingYards","rushingTds"=EXCLUDED."rushingTds","targets"=EXCLUDED."targets","receptions"=EXCLUDED."receptions","receivingYards"=EXCLUDED."receivingYards","receivingTds"=EXCLUDED."receivingTds","fumblesLost"=EXCLUDED."fumblesLost","grade"=EXCLUDED."grade","gradeScore"=EXCLUDED."gradeScore","performanceSummary"=EXCLUDED."performanceSummary","source"=EXCLUDED."source","sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt","refreshRunId"=EXCLUDED."refreshRunId","rawPayload"=EXCLUDED."rawPayload","observedAt"=NOW()`,
    id, player.id, player.sleeperId, gsisId, input.season, input.week, input.seasonType, input.team, input.opponent,
    input.fantasyHalfPpr, input.completions, input.attempts, input.passingYards, input.passingTds, input.interceptions,
    input.carries, input.rushingYards, input.rushingTds, input.targets, input.receptions, input.receivingYards, input.receivingTds, input.fumblesLost,
    graded.grade, graded.gradeScore, graded.summary, source, sourceUpdatedAt, (input as unknown as AnyObj).refreshRunId ?? null, JSON.stringify(raw ?? {}),
  );
  return true;
}

function gameFromNflverse(row: CsvRow, refreshRunId: string): GameInput {
  const receptions = n(row.receptions);
  const standard = n(row.fantasy_points);
  const half = row.fantasy_points !== undefined && row.fantasy_points !== "" ? standard + 0.5 * receptions : n(row.fantasy_points_ppr) - 0.5 * receptions;
  return {
    season: n(row.season), week: n(row.week), seasonType: row.season_type || "REG", team: row.team || row.recent_team || null,
    opponent: row.opponent_team || null, fantasyHalfPpr: half,
    completions: n(row.completions), attempts: n(row.attempts), passingYards: n(row.passing_yards), passingTds: n(row.passing_tds), interceptions: n(row.passing_interceptions),
    carries: n(row.carries), rushingYards: n(row.rushing_yards), rushingTds: n(row.rushing_tds), targets: n(row.targets), receptions,
    receivingYards: n(row.receiving_yards), receivingTds: n(row.receiving_tds), fumblesLost: n(row.rushing_fumbles_lost) + n(row.receiving_fumbles_lost) + n(row.sack_fumbles_lost),
    refreshRunId,
  } as GameInput;
}

function sleeperStat(item: AnyObj, key: string, ...aliases: string[]): number {
  const stats = item.stats && typeof item.stats === "object" ? item.stats as AnyObj : item;
  for (const name of [key, ...aliases]) {
    const value = stats[name];
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function gameFromSleeper(item: AnyObj, season: number, week: number, seasonType: "pre" | "regular" | "post", refreshRunId: string): GameInput {
  const team = s(item.team) ?? s((item.player as AnyObj | undefined)?.team);
  return {
    season, week, seasonType: seasonType === "pre" ? "PRE" : seasonType === "post" ? "POST" : "REG", team, opponent: s(item.opponent) ?? s(item.opponent_team),
    fantasyHalfPpr: sleeperStat(item, "pts_half_ppr", "pts_half", "pts_half_ppr_bonus"),
    completions: sleeperStat(item, "pass_cmp", "cmp"), attempts: sleeperStat(item, "pass_att", "att"), passingYards: sleeperStat(item, "pass_yd", "pass_yds"), passingTds: sleeperStat(item, "pass_td"), interceptions: sleeperStat(item, "pass_int", "int"),
    carries: sleeperStat(item, "rush_att", "car"), rushingYards: sleeperStat(item, "rush_yd", "rush_yds"), rushingTds: sleeperStat(item, "rush_td"),
    targets: sleeperStat(item, "rec_tgt", "targets", "tgt"), receptions: sleeperStat(item, "rec", "receptions"), receivingYards: sleeperStat(item, "rec_yd", "rec_yds"), receivingTds: sleeperStat(item, "rec_td"), fumblesLost: sleeperStat(item, "fum_lost"),
    refreshRunId,
  } as GameInput;
}

export async function refreshPlayerStats(refreshRunId: string): Promise<PlayerStatsRefreshResult> {
  const warnings: string[] = [];
  const [players, sleeperCatalog, nflState, nflversePlayers] = await Promise.all([currentLeaguePlayers(), getPlayerCatalog(), getNflState(), fetchNflversePlayers()]);
  const currentSeason = Number(nflState.season) || new Date().getFullYear();
  const byGsis = new Map(nflversePlayers.rows.filter((r) => r.gsis_id).map((r) => [r.gsis_id, r]));
  const byNamePos = new Map<string, CsvRow[]>();
  for (const row of nflversePlayers.rows) {
    const pos = (row.position ?? "").toUpperCase();
    const name = normalizePlayerName(row.display_name ?? row.football_name ?? "");
    if (!name || !pos) continue;
    const key = `${name}|${pos}`;
    const list = byNamePos.get(key) ?? []; list.push(row); byNamePos.set(key, list);
  }

  const resolved = new Map<string, { player: LeaguePlayer; gsisId: string | null; meta: CsvRow | null }>();
  let profilesStored = 0;
  for (const player of players) {
    const sleeperMeta = sleeperCatalog[player.sleeperId];
    let meta = sleeperMeta?.gsis_id ? byGsis.get(String(sleeperMeta.gsis_id)) ?? null : null;
    if (!meta) {
      const candidates = byNamePos.get(`${player.normalizedName}|${player.position}`) ?? [];
      if (candidates.length === 1) meta = candidates[0];
      else if (candidates.length > 1 && player.nflTeam) meta = candidates.find((r) => r.latest_team === player.nflTeam) ?? null;
    }
    const gsisId = meta?.gsis_id ?? sleeperMeta?.gsis_id ?? null;
    if (!gsisId) warnings.push(`${player.fullName}: no GSIS/nflverse match; current Sleeper preseason stats can still be stored by Sleeper ID.`);
    resolved.set(player.id, { player, gsisId, meta });
    await upsertProfile(player, meta, gsisId, nflversePlayers.updatedAt);
    profilesStored++;
  }

  const existing = await (prisma as any).$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "PlayerGameStat"`);
  const existingCount = Number(existing?.[0]?.count ?? 0);
  const historicalBackfill = existingCount < 500;
  const draftYears = [...resolved.values()].map((x) => maybeInt(x.meta?.draft_year)).filter((x): x is number => x !== null);
  const earliest = historicalBackfill ? Math.max(1999, Math.min(...(draftYears.length ? draftYears : [currentSeason - 10]))) : Math.max(1999, currentSeason - 1);
  const seasons = Array.from({ length: currentSeason - earliest + 1 }, (_, i) => earliest + i);
  let gamesStored = 0;
  const gsisToResolved = new Map([...resolved.values()].filter((x) => x.gsisId).map((x) => [x.gsisId!, x]));

  // Limit parallel downloads so the refresh remains provider-friendly and predictable.
  for (let i = 0; i < seasons.length; i += 4) {
    const chunk = seasons.slice(i, i + 4);
    const results = await Promise.all(chunk.map(async (season) => ({ season, ...(await fetchNflverseSeason(season)) })));
    for (const result of results) {
      for (const row of result.rows) {
        const match = gsisToResolved.get(row.player_id);
        if (!match) continue;
        const game = gameFromNflverse(row, refreshRunId);
        if (await upsertGame(match.player, match.gsisId, "NFLVERSE", result.updatedAt, row, game)) gamesStored++;
      }
    }
  }

  // Sleeper is used for the current season because it exposes preseason and week-level stats before nflverse's regular-season files settle.
  const sleeperRequests: Array<Promise<{ week: number; type: "pre" | "regular" | "post"; rows: AnyObj[] }>> = [];
  for (let week = 1; week <= 4; week++) sleeperRequests.push(fetchSleeperWeek(currentSeason, week, "pre").then((rows) => ({ week, type: "pre" as const, rows })));
  if (nflState.season_type === "regular" || nflState.season_type === "post") {
    const through = Math.max(1, Number(nflState.week) || 1);
    for (let week = Math.max(1, through - 2); week <= through; week++) sleeperRequests.push(fetchSleeperWeek(currentSeason, week, "regular").then((rows) => ({ week, type: "regular" as const, rows })));
  }
  if (nflState.season_type === "post") {
    for (let week = 1; week <= 5; week++) sleeperRequests.push(fetchSleeperWeek(currentSeason, week, "post").then((rows) => ({ week, type: "post" as const, rows })));
  }
  const bySleeper = new Map([...resolved.values()].map((x) => [x.player.sleeperId, x]));
  for (const result of await Promise.all(sleeperRequests)) {
    for (const item of result.rows) {
      const playerId = s(item.player_id) ?? s((item.player as AnyObj | undefined)?.player_id) ?? s(item.id);
      if (!playerId) continue;
      const match = bySleeper.get(playerId);
      if (!match) continue;
      const game = gameFromSleeper(item, currentSeason, result.week, result.type, refreshRunId);
      if (await upsertGame(match.player, match.gsisId, "SLEEPER", new Date(), item, game)) gamesStored++;
    }
  }

  return { playersResolved: [...resolved.values()].filter((x) => x.gsisId).length, profilesStored, gamesStored, seasonsFetched: seasons.length, historicalBackfill, warnings: warnings.slice(0, 30) };
}

export async function getStoredPerformance(playerId: string): Promise<StoredPerformanceContext> {
  const [profiles, games] = await Promise.all([
    (prisma as any).$queryRawUnsafe(`SELECT * FROM "PlayerFootballProfile" WHERE "playerId"=$1 LIMIT 1`, playerId),
    (prisma as any).$queryRawUnsafe(`SELECT * FROM "PlayerGameStat" WHERE "playerId"=$1 ORDER BY "season" DESC, CASE "seasonType" WHEN 'POST' THEN 3 WHEN 'REG' THEN 2 ELSE 1 END DESC, "week" DESC LIMIT 80`, playerId),
  ]);
  const typedGames = (games ?? []) as StoredGameStat[];
  const recentGames = typedGames.slice(0, 5);
  const reg = typedGames.filter((g) => g.seasonType === "REG" || g.seasonType === "POST").slice(0, 5);
  const avg = (rows: StoredGameStat[]) => rows.length ? rows.reduce((sum, g) => sum + Number(g.gradeScore), 0) / rows.length : null;
  return { profile: (profiles?.[0] ?? null) as FootballProfile | null, games: typedGames, latestGame: typedGames[0] ?? null, recentGames, recentAverageGrade: avg(recentGames), recentRegularAverageGrade: avg(reg) };
}

export async function getStoredPerformanceMap(playerIds: string[]): Promise<Map<string, StoredPerformanceContext>> {
  const out = new Map<string, StoredPerformanceContext>();
  if (!playerIds.length) return out;
  const [profiles, games] = await Promise.all([
    (prisma as any).$queryRawUnsafe(`SELECT * FROM "PlayerFootballProfile" WHERE "playerId" = ANY($1::text[])`, playerIds),
    (prisma as any).$queryRawUnsafe(`SELECT * FROM "PlayerGameStat" WHERE "playerId" = ANY($1::text[]) ORDER BY "season" DESC, "week" DESC`, playerIds),
  ]);
  const profileMap = new Map<string, FootballProfile>((profiles ?? []).map((p: FootballProfile) => [p.playerId, p]));
  const gameMap = new Map<string, StoredGameStat[]>();
  for (const game of (games ?? []) as StoredGameStat[]) { const list = gameMap.get(game.playerId) ?? []; if (list.length < 8) list.push(game); gameMap.set(game.playerId, list); }
  for (const id of playerIds) {
    const playerGames = gameMap.get(id) ?? [];
    const recentGames = playerGames.slice(0, 5);
    const reg = playerGames.filter((g) => g.seasonType === "REG" || g.seasonType === "POST").slice(0, 5);
    const avg = (rows: StoredGameStat[]) => rows.length ? rows.reduce((sum, g) => sum + Number(g.gradeScore), 0) / rows.length : null;
    out.set(id, { profile: profileMap.get(id) ?? null, games: playerGames, latestGame: playerGames[0] ?? null, recentGames, recentAverageGrade: avg(recentGames), recentRegularAverageGrade: avg(reg) });
  }
  return out;
}
