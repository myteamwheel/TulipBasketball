import Papa from "papaparse";
import { getNflState, getPlayerCatalog, type SleeperPlayer } from "@/lib/sleeper";

export interface PerformanceSummary {
  season: number;
  games: number;
  halfPprPoints: number;
  halfPprPpg: number;
  opportunities: number;
  opportunitiesPerGame: number;
  scrimmageYards: number;
  yardsPerGame: number;
  totalTds: number;
  targets: number;
  carries: number;
  receptions: number;
  passAttempts: number;
  last3HalfPprPpg: number | null;
  last3OpportunitiesPerGame: number | null;
  fantasyTrendPercent: number | null;
  usageTrendPercent: number | null;
  latestWeek: number | null;
}

export interface PlayerFootballContext {
  sleeperId: string;
  gsisId: string | null;
  age: number | null;
  yearsExp: number | null;
  active: boolean | null;
  depthChartOrder: number | null;
  depthChartPosition: string | null;
  injuryStatus: string | null;
  practiceDescription: string | null;
  currentSeason: PerformanceSummary | null;
  priorSeason: PerformanceSummary | null;
  statsSource: "NFLVERSE" | null;
  statsUpdatedAt: string | null;
}

type CsvRow = Record<string, string>;

function num(row: CsvRow, key: string): number {
  const v = Number(row[key]);
  return Number.isFinite(v) ? v : 0;
}

function maybeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function aggregate(rows: CsvRow[], season: number): PerformanceSummary | null {
  const reg = rows
    .filter((r) => Number(r.season) === season && (!r.season_type || r.season_type === "REG"))
    .sort((a, b) => num(a, "week") - num(b, "week"));
  if (reg.length === 0) return null;

  const games = reg.length;
  const sum = (key: string) => reg.reduce((s, r) => s + num(r, key), 0);
  const receptions = sum("receptions");
  const carries = sum("carries");
  const targets = sum("targets");
  const passAttempts = sum("attempts");
  const rushingYards = sum("rushing_yards");
  const receivingYards = sum("receiving_yards");
  const passingYards = sum("passing_yards");
  const totalTds = sum("rushing_tds") + sum("receiving_tds") + sum("passing_tds");
  const halfPprPoints = reg.reduce((s, r) => {
    const standard = num(r, "fantasy_points");
    if (standard !== 0 || r.fantasy_points !== undefined) return s + standard + 0.5 * num(r, "receptions");
    const ppr = num(r, "fantasy_points_ppr");
    return s + (ppr ? ppr - 0.5 * num(r, "receptions") : 0);
  }, 0);
  // Carries + targets are the most comparable opportunity metric for RB/WR/TE.
  // QB attempts are included only when a player has no meaningful carry/target volume.
  const skillOpps = carries + targets;
  const opportunities = skillOpps > 0 ? skillOpps : passAttempts;
  const scrimmageYards = rushingYards + receivingYards + (skillOpps === 0 ? passingYards : 0);

  const last3 = reg.slice(-3);
  const last3Points = last3.reduce((s, r) => {
    const standard = num(r, "fantasy_points");
    if (standard !== 0 || r.fantasy_points !== undefined) return s + standard + 0.5 * num(r, "receptions");
    const ppr = num(r, "fantasy_points_ppr");
    return s + (ppr ? ppr - 0.5 * num(r, "receptions") : 0);
  }, 0);
  const last3SkillOpps = last3.reduce((s, r) => s + num(r, "carries") + num(r, "targets"), 0);
  const last3PassAttempts = last3.reduce((s, r) => s + num(r, "attempts"), 0);
  const last3Opps = last3SkillOpps > 0 ? last3SkillOpps : last3PassAttempts;
  const seasonPpg = games ? halfPprPoints / games : 0;
  const seasonOppG = games ? opportunities / games : 0;
  const last3Ppg = last3.length ? last3Points / last3.length : null;
  const last3OppG = last3.length ? last3Opps / last3.length : null;

  return {
    season,
    games,
    halfPprPoints,
    halfPprPpg: seasonPpg,
    opportunities,
    opportunitiesPerGame: seasonOppG,
    scrimmageYards,
    yardsPerGame: games ? scrimmageYards / games : 0,
    totalTds,
    targets,
    carries,
    receptions,
    passAttempts,
    last3HalfPprPpg: last3Ppg,
    last3OpportunitiesPerGame: last3OppG,
    fantasyTrendPercent: games >= 4 && last3Ppg !== null && seasonPpg > 0 ? ((last3Ppg - seasonPpg) / seasonPpg) * 100 : null,
    usageTrendPercent: games >= 4 && last3OppG !== null && seasonOppG > 0 ? ((last3OppG - seasonOppG) / seasonOppG) * 100 : null,
    latestWeek: Math.max(...reg.map((r) => num(r, "week")).filter((w) => Number.isFinite(w)), 0) || null,
  };
}

const seasonCache = new Map<number, { at: number; promise: Promise<{ rows: CsvRow[]; updatedAt: string | null }> }>();

async function fetchSeasonRows(season: number): Promise<{ rows: CsvRow[]; updatedAt: string | null }> {
  const cached = seasonCache.get(season);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.promise;
  const promise = (async () => {
    const url = `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
    try {
      const res = await fetch(url, { cache: "no-store", headers: { Accept: "text/csv" } });
      if (!res.ok) return { rows: [], updatedAt: null };
      const text = await res.text();
      const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true });
      const updatedAt = res.headers.get("last-modified") ?? res.headers.get("date");
      return { rows: parsed.data, updatedAt };
    } catch {
      return { rows: [], updatedAt: null };
    }
  })();
  seasonCache.set(season, { at: Date.now(), promise });
  return promise;
}

function baseContext(sleeperId: string, meta: SleeperPlayer | undefined): PlayerFootballContext {
  return {
    sleeperId,
    gsisId: meta?.gsis_id ? String(meta.gsis_id) : null,
    age: maybeNumber(meta?.age),
    yearsExp: maybeNumber(meta?.years_exp),
    active: typeof meta?.active === "boolean" ? meta.active : null,
    depthChartOrder: maybeNumber(meta?.depth_chart_order),
    depthChartPosition: meta?.depth_chart_position ?? null,
    injuryStatus: meta?.injury_status ?? meta?.status ?? null,
    practiceDescription: meta?.practice_description ?? null,
    currentSeason: null,
    priorSeason: null,
    statsSource: null,
    statsUpdatedAt: null,
  };
}

export async function getFootballContexts(sleeperIds: string[]): Promise<Map<string, PlayerFootballContext>> {
  const [catalog, nflState] = await Promise.all([getPlayerCatalog(), getNflState()]);
  const season = Number(nflState.season) || new Date().getFullYear();
  const [current, prior] = await Promise.all([fetchSeasonRows(season), fetchSeasonRows(season - 1)]);

  const currentByGsis = new Map<string, CsvRow[]>();
  const priorByGsis = new Map<string, CsvRow[]>();
  for (const row of current.rows) {
    const id = row.player_id;
    if (!id) continue;
    const list = currentByGsis.get(id) ?? [];
    list.push(row); currentByGsis.set(id, list);
  }
  for (const row of prior.rows) {
    const id = row.player_id;
    if (!id) continue;
    const list = priorByGsis.get(id) ?? [];
    list.push(row); priorByGsis.set(id, list);
  }

  const out = new Map<string, PlayerFootballContext>();
  for (const sleeperId of sleeperIds) {
    const meta = catalog[sleeperId];
    const ctx = baseContext(sleeperId, meta);
    if (ctx.gsisId) {
      ctx.currentSeason = aggregate(currentByGsis.get(ctx.gsisId) ?? [], season);
      ctx.priorSeason = aggregate(priorByGsis.get(ctx.gsisId) ?? [], season - 1);
      if (ctx.currentSeason || ctx.priorSeason) {
        ctx.statsSource = "NFLVERSE";
        ctx.statsUpdatedAt = current.updatedAt ?? prior.updatedAt;
      }
    }
    out.set(sleeperId, ctx);
  }
  return out;
}
