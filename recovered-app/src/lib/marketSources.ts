import { prisma } from "@/lib/prisma";
import { normalizePlayerName } from "@/lib/normalize";
import {
  CONSENSUS_WEIGHTS,
  KTC_DIRECT_REFRESH_ENABLED,
  MARKET_SOURCE_MAX_AGE_MS,
  FANTASYCALC_REFRESH_ENABLED,
  STATSGUY_REFRESH_ENABLED,
  SECONDARY_DISAGREEMENT_ABS,
  SECONDARY_DISAGREEMENT_REL,
} from "@/lib/config";
import { commitKtcImport, type KtcImportRow } from "@/lib/ktcImport";

export type MarketSourceKey = "KTC" | "FANTASYCALC" | "STATSGUY";
const marketDb = prisma as typeof prisma & {
  marketObservation: any;
  consensusObservation: any;
  draftPickObservation: any;
};

export interface MarketSourceStatus {
  source: MarketSourceKey;
  enabled: boolean;
  ok: boolean;
  eligibleForConsensus: boolean;
  fetchedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceAgeMs: number | null;
  rowsReceived: number;
  rowsStored: number;
  message: string;
}

export interface MarketRefreshResult {
  statuses: MarketSourceStatus[];
  consensusPlayersStored: number;
  marketObservationsStored: number;
  draftPickObservationsStored: number;
  fantasyCalcCalibrationPairs: number;
  statsGuyCalibrationPairs: number;
}

interface ProviderRow {
  sleeperId?: string;
  ktcId?: string;
  name: string;
  position?: string;
  team?: string;
  rawValue: number;
  rank?: number;
  positionRank?: number;
  metadata?: Record<string, unknown>;
}

interface ProviderSnapshot {
  source: MarketSourceKey;
  sourceUrl: string;
  fetchedAt: Date;
  sourceUpdatedAt: Date;
  rows: ProviderRow[];
  message: string;
}

const KTC_URL = "https://keeptradecut.com/dynasty-rankings";
const FANTASYCALC_URL = "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5&includeAdp=false";
const STATSGUY_URL = "https://api.statsguyfantasy.com/api/v1/players";
const MIN_PROVIDER_ROWS = 200;

function sourceAge(sourceUpdatedAt: Date, now = new Date()): number {
  return Math.max(0, now.getTime() - sourceUpdatedAt.getTime());
}

function assertFresh(source: string, sourceUpdatedAt: Date, now = new Date()): void {
  const age = sourceAge(sourceUpdatedAt, now);
  if (!Number.isFinite(sourceUpdatedAt.getTime())) throw new Error(`${source} did not provide a valid update timestamp`);
  if (age > MARKET_SOURCE_MAX_AGE_MS) {
    const hours = (age / 3600000).toFixed(1);
    throw new Error(`${source} data is ${hours}h old and exceeds the freshness cutoff; excluded`);
  }
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function parseKtcFreshness(html: string, fetchedAt: Date): Date {
  if (/Values updated\s+(?:just now|moments ago)/i.test(html)) return fetchedAt;
  const m = html.match(/Values updated\s+(\d+)\s+(second|minute|hour|day)s?\s+ago/i);
  if (!m) throw new Error("KTC freshness timestamp was not found; refusing to treat the page as current");
  const amount = Number(m[1]);
  const unit = m[2].toLowerCase();
  const unitMs = unit === "second" ? 1000 : unit === "minute" ? 60000 : unit === "hour" ? 3600000 : 86400000;
  return new Date(fetchedAt.getTime() - amount * unitMs);
}

function extractJsonArrayAfterMarker(html: string, marker: RegExp): unknown[] | null {
  const match = marker.exec(html);
  if (!match) return null;
  const from = match.index + match[0].length;
  const open = html.indexOf("[", from);
  if (open < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(html.slice(open, i + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractKtcRows(html: string): unknown[] {
  for (const marker of [/\bvar\s+playersArray\s*=\s*/, /\blet\s+playersArray\s*=\s*/, /\bconst\s+playersArray\s*=\s*/]) {
    const parsed = extractJsonArrayAfterMarker(html, marker);
    if (parsed && parsed.length > 0) return parsed;
  }
  throw new Error("KTC full playersArray was not found; page structure may have changed");
}

function parseKtcValue(item: Record<string, unknown>): { value: number; rank?: number; positionRank?: number } | null {
  const bucket = item.superflexValues;
  if (!bucket || typeof bucket !== "object") return null;
  const b = bucket as Record<string, unknown>;
  const candidates: Record<string, unknown>[] = [];
  if (b.value && typeof b.value === "object") candidates.push(b.value as Record<string, unknown>);
  candidates.push(b);
  for (const candidate of candidates) {
    const value = Number(candidate.value);
    if (!Number.isFinite(value) || value < 0 || value > 10000) continue;
    const rank = Number(candidate.overallRank ?? candidate.rank);
    const positionRank = Number(candidate.positionalRank ?? candidate.positionRank);
    return {
      value: Math.round(value),
      rank: Number.isFinite(rank) ? Math.round(rank) : undefined,
      positionRank: Number.isFinite(positionRank) ? Math.round(positionRank) : undefined,
    };
  }
  return null;
}

export async function fetchKtcSnapshot(): Promise<ProviderSnapshot> {
  const fetchedAt = new Date();
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache, no-store, max-age=0",
    Pragma: "no-cache",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  };
  async function getPage(url: string): Promise<string> {
    const response = await fetch(url, { cache: "no-store", signal: withTimeout(30000), headers });
    if (!response.ok) throw new Error(`KTC public rankings request failed (${response.status}) for ${url}`);
    const html = await response.text();
    if (html.length < 10000) throw new Error(`KTC returned an unexpectedly small page (${html.length} bytes) for ${url}`);
    return html;
  }

  const baseHtml = await getPage(KTC_URL);
  const sourceUpdatedAt = parseKtcFreshness(baseHtml, fetchedAt);
  assertFresh("KTC", sourceUpdatedAt, fetchedAt);

  // The base embedded array does not include every deep player. Joe Mixon is a
  // concrete regression case: his current public KTC profile exists, but he was
  // absent from the base array. Merge the public ranking pages so rostered deep
  // assets are not silently treated as "no KTC value".
  const pageNumbers = Array.from({ length: 11 }, (_, i) => i + 2); // pages 2..12
  const extraPages = await Promise.allSettled(pageNumbers.map((page) => getPage(`${KTC_URL}?page=${page}`)));
  const htmlPages = [baseHtml, ...extraPages.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled").map((r) => r.value)];

  const rowsByKey = new Map<string, ProviderRow>();
  for (const html of htmlPages) {
    let rawRows: unknown[] = [];
    try { rawRows = extractKtcRows(html); } catch { continue; }
    for (const raw of rawRows) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const parsed = parseKtcValue(item);
      if (!parsed) continue;
      const name = String(item.playerName ?? item.name ?? "").trim();
      if (!name) continue;
      const position = String(item.position ?? "").trim().toUpperCase() || undefined;
      const ktcId = String(item.playerID ?? item.id ?? "").trim() || undefined;
      const row: ProviderRow = {
        ktcId,
        name,
        position,
        team: String(item.team ?? "").trim() || undefined,
        rawValue: parsed.value,
        rank: parsed.rank,
        positionRank: parsed.positionRank,
        metadata: { age: item.age ?? null },
      };
      const key = ktcId ? `id:${ktcId}` : `np:${normalizePlayerName(name)}|${position ?? ""}`;
      rowsByKey.set(key, row);
    }
  }
  const rows = [...rowsByKey.values()];
  if (rows.length < MIN_PROVIDER_ROWS) throw new Error(`KTC returned only ${rows.length} valued assets after pagination; refusing partial snapshot`);
  const pageSuccesses = htmlPages.length;
  return {
    source: "KTC",
    sourceUrl: KTC_URL,
    fetchedAt,
    sourceUpdatedAt,
    rows,
    message: `KTC live rankings; ${rows.length} unique assets across ${pageSuccesses} public ranking pages; page updated ${Math.round(sourceAge(sourceUpdatedAt, fetchedAt) / 60000)}m before this refresh`,
  };
}

interface FantasyCalcPlayer {
  name?: string;
  sleeperId?: string;
  position?: string;
  maybeTeam?: string | null;
}
interface FantasyCalcValueRow {
  player?: FantasyCalcPlayer;
  value?: number;
  overallRank?: number;
  positionRank?: number;
  trend30Day?: number;
}

export async function fetchFantasyCalcSnapshot(): Promise<ProviderSnapshot> {
  const fetchedAt = new Date();
  const response = await fetch(FANTASYCALC_URL, {
    cache: "no-store",
    signal: withTimeout(20000),
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`FantasyCalc live values API failed (${response.status})`);
  const data = await response.json() as FantasyCalcValueRow[];
  const rows: ProviderRow[] = (Array.isArray(data) ? data : []).flatMap((entry) => {
    const player = entry.player;
    const rawValue = Number(entry.value);
    const name = player?.name?.trim();
    if (!player?.sleeperId || !name || !Number.isFinite(rawValue) || rawValue < 0) return [];
    return [{
      sleeperId: String(player.sleeperId),
      name,
      position: player.position?.toUpperCase(),
      team: player.maybeTeam ?? undefined,
      rawValue: Math.round(rawValue),
      rank: Number.isFinite(Number(entry.overallRank)) ? Math.round(Number(entry.overallRank)) : undefined,
      positionRank: Number.isFinite(Number(entry.positionRank)) ? Math.round(Number(entry.positionRank)) : undefined,
      metadata: {
        trend30Day: Number.isFinite(Number(entry.trend30Day)) ? Number(entry.trend30Day) : null,
        exactFormat: "12-team Superflex / 0.5 PPR / no TEP",
        sourceTimestampVerified: false,
        freshnessBasis: "live API fetch; provider-published 3-hour recalculation cadence",
      },
    }];
  });
  if (rows.length < 300) throw new Error(`FantasyCalc returned only ${rows.length} valued players; refusing partial snapshot`);
  // FantasyCalc's current endpoint does not expose a per-snapshot source timestamp.
  // Store fetchedAt as the observation anchor, but say that explicitly in metadata/UI.
  return {
    source: "FANTASYCALC",
    sourceUrl: FANTASYCALC_URL,
    fetchedAt,
    sourceUpdatedAt: fetchedAt,
    rows,
    message: `FantasyCalc live API; ${rows.length} assets for exact league format; fetched now (provider advertises a 3-hour recalculation cadence; endpoint exposes no snapshot timestamp)`,
  };
}

interface StatsGuyPlayer {
  id?: string;
  name?: string;
  team?: string;
  position?: string;
  value?: Record<string, number | undefined>;
  rank?: Record<string, number | undefined>;
  positionRank?: Record<string, number | undefined>;
  valueChange?: Record<string, { days7?: number; days30?: number } | undefined>;
}
interface StatsGuyResponse {
  valuesAsOf?: Record<string, string | undefined>;
  players?: StatsGuyPlayer[];
}

export async function fetchStatsGuySnapshot(): Promise<ProviderSnapshot> {
  const fetchedAt = new Date();
  const response = await fetch(STATSGUY_URL, {
    cache: "no-store",
    signal: withTimeout(20000),
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`Stats Guy Fantasy API failed (${response.status})`);
  const data = await response.json() as StatsGuyResponse;
  const asOf = data.valuesAsOf?.sf_dynasty;
  if (!asOf) throw new Error("Stats Guy Fantasy did not return valuesAsOf.sf_dynasty");
  const sourceUpdatedAt = new Date(asOf);
  assertFresh("Stats Guy Fantasy", sourceUpdatedAt, fetchedAt);
  const players = Array.isArray(data.players) ? data.players : [];
  const rows: ProviderRow[] = players.flatMap((player) => {
    const value = Number(player.value?.sf_dynasty);
    const name = player.name?.trim();
    if (!player.id || !name || !Number.isFinite(value) || value < 0) return [];
    return [{
      sleeperId: String(player.id),
      name,
      position: player.position?.toUpperCase(),
      team: player.team,
      rawValue: Math.round(value),
      rank: Number.isFinite(Number(player.rank?.sf_dynasty)) ? Number(player.rank?.sf_dynasty) : undefined,
      positionRank: Number.isFinite(Number(player.positionRank?.sf_dynasty)) ? Number(player.positionRank?.sf_dynasty) : undefined,
      metadata: { valueChange: player.valueChange?.sf_dynasty ?? null },
    }];
  });
  if (rows.length < MIN_PROVIDER_ROWS) throw new Error(`Stats Guy Fantasy returned only ${rows.length} valued players; refusing partial snapshot`);
  return { source: "STATSGUY", sourceUrl: STATSGUY_URL, fetchedAt, sourceUpdatedAt, rows, message: `Stats Guy Fantasy official API; values as of ${sourceUpdatedAt.toISOString()}` };
}

async function currentLeaguePlayers() {
  const entries = await prisma.ownershipInterval.findMany({ where: { validTo: null }, include: { player: true } });
  return [...new Map(entries.map((e) => [e.player.id, e.player])).values()];
}

type DraftPickBucket = "EARLY" | "MID" | "LATE";
function parseDraftPickRow(row: ProviderRow): { season: number; round: number; bucket: DraftPickBucket; label: string; value: number } | null {
  const m = row.name.match(/^(20\d{2})\s+(Early|Mid|Late)\s+([1-4])(?:st|nd|rd|th)$/i);
  if (!m) return null;
  const bucket = m[2].toUpperCase() as DraftPickBucket;
  return { season: Number(m[1]), round: Number(m[3]), bucket, label: `${m[1]} ${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()} ${m[3]}${Number(m[3])===1?'st':Number(m[3])===2?'nd':Number(m[3])===3?'rd':'th'}`, value: row.rawValue };
}

async function persistDraftPickObservations(snapshot: ProviderSnapshot, refreshRunId: string): Promise<number> {
  if (snapshot.source !== "KTC") return 0;
  const picks = snapshot.rows.map(parseDraftPickRow).filter((x): x is NonNullable<typeof x> => !!x);
  if (picks.length === 0) return 0;
  const data = picks.map((p) => ({
    season: p.season,
    round: p.round,
    bucket: p.bucket,
    label: p.label,
    value: p.value,
    observedAt: snapshot.fetchedAt,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    sourceUrl: snapshot.sourceUrl,
    refreshRunId,
  }));
  const result = await marketDb.draftPickObservation.createMany({ data, skipDuplicates: true });
  return Number(result?.count ?? 0);
}

async function persistKtc(snapshot: ProviderSnapshot, refreshRunId: string): Promise<number> {
  const leaguePlayers = await currentLeaguePlayers();
  const currentIds = new Set(leaguePlayers.map((p) => p.ktcId).filter(Boolean));
  const currentNamePos = new Set(leaguePlayers.map((p) => `${p.normalizedName}|${p.position}`));
  const relevant = snapshot.rows.filter((r) => {
    if (parseDraftPickRow(r)) return false;
    return (r.ktcId && currentIds.has(r.ktcId)) || currentNamePos.has(`${normalizePlayerName(r.name)}|${r.position ?? ""}`);
  });
  const importRows: KtcImportRow[] = relevant.map((r) => ({ name: r.name, position: r.position, team: r.team, value: r.rawValue, ktcId: r.ktcId, rank: r.rank }));
  const summary = await commitKtcImport(importRows, { sourceUrl: snapshot.sourceUrl, refreshRunId, sourceType: "AUTO_SCRAPE", observedAt: snapshot.fetchedAt });
  let stored = 0;
  const seen = new Set<string>();
  for (const result of summary.results) {
    if (!result.playerId || seen.has(result.playerId)) continue;
    if (["flagged", "rejected", "ambiguous", "unmatched"].includes(result.outcome)) continue;
    seen.add(result.playerId);
    const sourceRow = relevant.find((r) =>
      (r.ktcId && result.row.ktcId === r.ktcId) ||
      (normalizePlayerName(result.row.name) === normalizePlayerName(r.name) && result.row.position === r.position),
    );
    if (!sourceRow) continue;
    try {
      await marketDb.marketObservation.create({ data: {
        playerId: result.playerId,
        source: "KTC",
        rawValue: sourceRow.rawValue,
        normalizedValue: sourceRow.rawValue, // KTC defines the canonical scale.
        observedAt: snapshot.fetchedAt,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        sourceUrl: snapshot.sourceUrl,
        refreshRunId,
        sourceRank: sourceRow.rank,
        positionRank: sourceRow.positionRank,
        metadata: JSON.stringify({ ...(sourceRow.metadata ?? {}), scale: "KTC_CANONICAL" }),
      }});
      stored++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("unique")) throw err;
    }
  }
  return stored;
}

async function persistFantasyCalc(snapshot: ProviderSnapshot, refreshRunId: string): Promise<number> {
  const leaguePlayers = await currentLeaguePlayers();
  const bySleeper = new Map(leaguePlayers.map((p) => [p.sleeperId, p]));
  let stored = 0;
  const seen = new Set<string>();
  for (const row of snapshot.rows) {
    const player = row.sleeperId ? bySleeper.get(row.sleeperId) : undefined;
    if (!player || seen.has(player.id)) continue;
    seen.add(player.id);
    try {
      await marketDb.marketObservation.create({ data: {
        playerId: player.id,
        source: "FANTASYCALC",
        rawValue: row.rawValue,
        normalizedValue: row.rawValue,
        observedAt: snapshot.fetchedAt,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        sourceUrl: snapshot.sourceUrl,
        refreshRunId,
        sourceRank: row.rank,
        positionRank: row.positionRank,
        metadata: JSON.stringify({ ...(row.metadata ?? {}), scale: "FANTASYCALC_RAW_PENDING_KTC_CALIBRATION" }),
      }});
      stored++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("unique")) throw err;
    }
  }
  return stored;
}

async function persistStatsGuy(snapshot: ProviderSnapshot, refreshRunId: string): Promise<number> {
  const leaguePlayers = await currentLeaguePlayers();
  const bySleeper = new Map(leaguePlayers.map((p) => [p.sleeperId, p]));
  const byNamePos = new Map<string, typeof leaguePlayers>();
  for (const p of leaguePlayers) {
    const key = `${p.normalizedName}|${p.position}`;
    const list = byNamePos.get(key) ?? [];
    list.push(p);
    byNamePos.set(key, list);
  }
  let stored = 0;
  const seen = new Set<string>();
  for (const row of snapshot.rows) {
    let player = row.sleeperId ? bySleeper.get(row.sleeperId) : undefined;
    if (!player) {
      const candidates = byNamePos.get(`${normalizePlayerName(row.name)}|${row.position ?? ""}`) ?? [];
      if (candidates.length === 1) player = candidates[0];
    }
    if (!player || seen.has(player.id)) continue;
    seen.add(player.id);
    try {
      await marketDb.marketObservation.create({ data: {
        playerId: player.id,
        source: "STATSGUY",
        rawValue: row.rawValue,
        normalizedValue: row.rawValue, // overwritten by same-refresh KTC calibration below.
        observedAt: snapshot.fetchedAt,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        sourceUrl: snapshot.sourceUrl,
        refreshRunId,
        sourceRank: row.rank,
        positionRank: row.positionRank,
        metadata: JSON.stringify({ ...(row.metadata ?? {}), scale: "STATSGUY_RAW_PENDING_KTC_CALIBRATION" }),
      }});
      stored++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("unique")) throw err;
    }
  }
  return stored;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx), t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

type QuantileMap = { xs: number[]; ys: number[]; pairCount: number };
function buildQuantileMap(pairs: { sg: number; ktc: number }[]): QuantileMap | null {
  if (pairs.length < 12) return null;
  const sg = pairs.map((p) => p.sg).sort((a,b)=>a-b);
  const ktc = pairs.map((p) => p.ktc).sort((a,b)=>a-b);
  const qs = [0, .05, .1, .2, .3, .4, .5, .6, .7, .8, .9, .95, 1];
  const xs: number[] = [], ys: number[] = [];
  for (const q of qs) {
    const x = quantile(sg, q), y = quantile(ktc, q);
    if (xs.length && Math.abs(x - xs[xs.length - 1]) < 1e-9) {
      ys[ys.length - 1] = Math.max(ys[ys.length - 1], y);
      continue;
    }
    xs.push(x); ys.push(y);
  }
  return xs.length >= 2 ? { xs, ys, pairCount: pairs.length } : null;
}
function applyQuantileMap(map: QuantileMap, value: number): number {
  const { xs, ys } = map;
  if (value <= xs[0]) return Math.round(ys[0]);
  if (value >= xs[xs.length - 1]) return Math.round(ys[ys.length - 1]);
  for (let i = 1; i < xs.length; i++) {
    if (value <= xs[i]) {
      const span = xs[i] - xs[i-1];
      const t = span <= 0 ? 0 : (value - xs[i-1]) / span;
      return Math.round(ys[i-1] + t * (ys[i] - ys[i-1]));
    }
  }
  return Math.round(ys[ys.length - 1]);
}

async function calibrateSecondaryToKtc(
  refreshRunId: string,
  source: "FANTASYCALC" | "STATSGUY",
  ktcSnapshot: ProviderSnapshot,
  secondarySnapshot: ProviderSnapshot,
): Promise<number> {
  const ktcByNamePos = new Map<string, ProviderRow>();
  for (const row of ktcSnapshot.rows) {
    if (parseDraftPickRow(row)) continue;
    const pos = (row.position ?? "").toUpperCase();
    if (!["QB", "RB", "WR", "TE"].includes(pos)) continue;
    ktcByNamePos.set(`${normalizePlayerName(row.name)}|${pos}`, row);
  }
  const fullPairs: { secondary: number; ktc: number; position: string }[] = [];
  for (const row of secondarySnapshot.rows) {
    const pos = (row.position ?? "").toUpperCase();
    const ktc = ktcByNamePos.get(`${normalizePlayerName(row.name)}|${pos}`);
    if (ktc) fullPairs.push({ secondary: row.rawValue, ktc: ktc.rawValue, position: pos });
  }
  const toPair = (p: { secondary: number; ktc: number }) => ({ sg: p.secondary, ktc: p.ktc });
  const overall = buildQuantileMap(fullPairs.map(toPair));
  if (!overall) return 0;
  const positionMaps = new Map<string, QuantileMap>();
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const map = buildQuantileMap(fullPairs.filter((p) => p.position === pos).map(toPair));
    if (map) positionMaps.set(pos, map);
  }

  const secondaryRows = await marketDb.marketObservation.findMany({
    where: { refreshRunId, source },
    include: { player: { select: { position: true } } },
  });
  for (const row of secondaryRows as any[]) {
    const pos = String(row.player?.position ?? "").toUpperCase();
    const map = positionMaps.get(pos) ?? overall;
    const equivalent = Math.max(0, Math.min(10000, applyQuantileMap(map, row.rawValue)));
    let oldMeta: Record<string, unknown> = {};
    try { oldMeta = JSON.parse(row.metadata || "{}"); } catch {}
    await marketDb.marketObservation.update({ where: { id: row.id }, data: {
      normalizedValue: equivalent,
      metadata: JSON.stringify({
        ...oldMeta,
        scale: "KTC_EQUIVALENT",
        scaleMethod: positionMaps.has(pos) ? "POSITION_QUANTILE_MAP_FULL_UNIVERSE" : "OVERALL_QUANTILE_MAP_FULL_UNIVERSE",
        calibrationPairs: map.pairCount,
        calibrationUniversePairs: fullPairs.length,
        rawSecondaryValue: row.rawValue,
        ktcEquivalentValue: equivalent,
      }),
    }});
  }
  return fullPairs.length;
}

async function calibrateFantasyCalcToKtc(refreshRunId: string, ktcSnapshot: ProviderSnapshot, fantasyCalcSnapshot: ProviderSnapshot): Promise<number> {
  return calibrateSecondaryToKtc(refreshRunId, "FANTASYCALC", ktcSnapshot, fantasyCalcSnapshot);
}
async function calibrateStatsGuyToKtc(refreshRunId: string, ktcSnapshot: ProviderSnapshot, statsGuySnapshot: ProviderSnapshot): Promise<number> {
  return calibrateSecondaryToKtc(refreshRunId, "STATSGUY", ktcSnapshot, statsGuySnapshot);
}

async function buildConsensus(refreshRunId: string, observedAt = new Date()): Promise<number> {
  const observations = await marketDb.marketObservation.findMany({ where: { refreshRunId } });
  const byPlayer = new Map<string, any[]>();
  for (const obs of observations) {
    const list = byPlayer.get(obs.playerId) ?? [];
    list.push(obs);
    byPlayer.set(obs.playerId, list);
  }
  let stored = 0;
  for (const [playerId, list] of byPlayer) {
    const fresh = list.filter((o: any) => {
      const anchor = o.sourceUpdatedAt ?? o.observedAt;
      return observedAt.getTime() - anchor.getTime() <= MARKET_SOURCE_MAX_AGE_MS;
    });
    const ktc = fresh.find((o: any) => o.source === "KTC");
    if (!ktc) continue; // Never manufacture a consensus without the KTC anchor.

    const fantasyCalc = fresh.find((o: any) => o.source === "FANTASYCALC");
    const eligible: any[] = [ktc];
    let effectiveWeights: Record<string, number> = { KTC: 1 };
    let exclusionReason: string | null = null;

    if (fantasyCalc) {
      const absGap = Math.abs(fantasyCalc.normalizedValue - ktc.rawValue);
      const relGap = absGap / Math.max(ktc.rawValue, 1);
      if (absGap >= SECONDARY_DISAGREEMENT_ABS && relGap >= SECONDARY_DISAGREEMENT_REL) {
        exclusionReason = `High source disagreement: FantasyCalc KTC-equivalent differs from KTC by ${absGap} (${Math.round(relGap * 100)}%)`;
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(fantasyCalc.metadata || "{}"); } catch {}
        await marketDb.marketObservation.update({ where: { id: fantasyCalc.id }, data: {
          metadata: JSON.stringify({ ...meta, consensusEligible: false, consensusExclusionReason: exclusionReason, ktcAnchorValue: ktc.rawValue }),
        }}).catch(() => undefined);
      } else {
        eligible.push(fantasyCalc);
        effectiveWeights = { KTC: CONSENSUS_WEIGHTS.KTC, FANTASYCALC: CONSENSUS_WEIGHTS.FANTASYCALC };
      }
    }

    const value = eligible.length === 1
      ? ktc.rawValue
      : Math.round(ktc.rawValue * effectiveWeights.KTC + fantasyCalc.normalizedValue * effectiveWeights.FANTASYCALC);
    await marketDb.consensusObservation.upsert({
      where: { playerId_refreshRunId: { playerId, refreshRunId } },
      update: {},
      create: {
        playerId,
        value,
        observedAt,
        refreshRunId,
        sourcesUsed: JSON.stringify(eligible.map((o: any) => o.source)),
        sourceCount: eligible.length,
        weights: JSON.stringify({ ...effectiveWeights, ...(exclusionReason ? { excluded: { FANTASYCALC: exclusionReason } } : {}) }),
      },
    });
    stored++;
  }
  return stored;
}

function disabledStatus(source: MarketSourceKey): MarketSourceStatus {
  return { source, enabled: false, ok: false, eligibleForConsensus: false, fetchedAt: null, sourceUpdatedAt: null, sourceAgeMs: null, rowsReceived: 0, rowsStored: 0, message: "Disabled by configuration" };
}

export async function refreshLiveMarketSources(refreshRunId: string): Promise<MarketRefreshResult> {
  const [ktcResult, fcResult, sgResult] = await Promise.allSettled([
    KTC_DIRECT_REFRESH_ENABLED ? fetchKtcSnapshot() : Promise.reject(new Error("KTC disabled")),
    FANTASYCALC_REFRESH_ENABLED ? fetchFantasyCalcSnapshot() : Promise.reject(new Error("FantasyCalc disabled")),
    STATSGUY_REFRESH_ENABLED ? fetchStatsGuySnapshot() : Promise.reject(new Error("Stats Guy diagnostic disabled")),
  ]);
  const statuses: MarketSourceStatus[] = [];
  let pickStored = 0;

  if (ktcResult.status === "fulfilled") {
    const snap = ktcResult.value;
    try {
      assertFresh("KTC", snap.sourceUpdatedAt, snap.fetchedAt);
      pickStored = await persistDraftPickObservations(snap, refreshRunId);
      const stored = await persistKtc(snap, refreshRunId);
      statuses.push({ source: "KTC", enabled: true, ok: true, eligibleForConsensus: true, fetchedAt: snap.fetchedAt.toISOString(), sourceUpdatedAt: snap.sourceUpdatedAt.toISOString(), sourceAgeMs: sourceAge(snap.sourceUpdatedAt, snap.fetchedAt), rowsReceived: snap.rows.length, rowsStored: stored, message: `${snap.message}; ${pickStored} KTC draft-pick buckets stored` });
    } catch (err) {
      statuses.push({ source: "KTC", enabled: true, ok: false, eligibleForConsensus: false, fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, sourceAgeMs: null, rowsReceived: 0, rowsStored: 0, message: err instanceof Error ? err.message : String(err) });
    }
  } else statuses.push({ source: "KTC", enabled: KTC_DIRECT_REFRESH_ENABLED, ok: false, eligibleForConsensus: false, fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, sourceAgeMs: null, rowsReceived: 0, rowsStored: 0, message: ktcResult.reason instanceof Error ? ktcResult.reason.message : String(ktcResult.reason) });

  if (fcResult.status === "fulfilled") {
    const snap = fcResult.value;
    try {
      const stored = await persistFantasyCalc(snap, refreshRunId);
      statuses.push({ source: "FANTASYCALC", enabled: true, ok: true, eligibleForConsensus: true, fetchedAt: snap.fetchedAt.toISOString(), sourceUpdatedAt: snap.sourceUpdatedAt.toISOString(), sourceAgeMs: 0, rowsReceived: snap.rows.length, rowsStored: stored, message: snap.message });
    } catch (err) {
      statuses.push({ source: "FANTASYCALC", enabled: true, ok: false, eligibleForConsensus: false, fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, sourceAgeMs: null, rowsReceived: 0, rowsStored: 0, message: err instanceof Error ? err.message : String(err) });
    }
  } else statuses.push({ source: "FANTASYCALC", enabled: FANTASYCALC_REFRESH_ENABLED, ok: false, eligibleForConsensus: false, fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, sourceAgeMs: null, rowsReceived: 0, rowsStored: 0, message: fcResult.reason instanceof Error ? fcResult.reason.message : String(fcResult.reason) });

  if (sgResult.status === "fulfilled") {
    const snap = sgResult.value;
    try {
      assertFresh("Stats Guy", snap.sourceUpdatedAt, snap.fetchedAt);
      const stored = await persistStatsGuy(snap, refreshRunId);
      statuses.push({ source: "STATSGUY", enabled: true, ok: true, eligibleForConsensus: false, fetchedAt: snap.fetchedAt.toISOString(), sourceUpdatedAt: snap.sourceUpdatedAt.toISOString(), sourceAgeMs: sourceAge(snap.sourceUpdatedAt, snap.fetchedAt), rowsReceived: snap.rows.length, rowsStored: stored, message: `${snap.message}; diagnostic only — excluded from consensus` });
    } catch (err) {
      statuses.push({ source: "STATSGUY", enabled: true, ok: false, eligibleForConsensus: false, fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, sourceAgeMs: null, rowsReceived: 0, rowsStored: 0, message: err instanceof Error ? err.message : String(err) });
    }
  } else statuses.push({ source: "STATSGUY", enabled: STATSGUY_REFRESH_ENABLED, ok: false, eligibleForConsensus: false, fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, sourceAgeMs: null, rowsReceived: 0, rowsStored: 0, message: sgResult.reason instanceof Error ? sgResult.reason.message : String(sgResult.reason) });

  let fantasyCalcCalibrationPairs = 0;
  let statsGuyCalibrationPairs = 0;
  if (ktcResult.status === "fulfilled" && fcResult.status === "fulfilled" && statuses.find((s) => s.source === "KTC")?.ok && statuses.find((s) => s.source === "FANTASYCALC")?.ok) {
    fantasyCalcCalibrationPairs = await calibrateFantasyCalcToKtc(refreshRunId, ktcResult.value, fcResult.value);
    const fcStatus = statuses.find((s) => s.source === "FANTASYCALC");
    if (fcStatus) fcStatus.message += `; ${fantasyCalcCalibrationPairs} same-refresh overlap pairs translated onto KTC scale`;
  }
  if (ktcResult.status === "fulfilled" && sgResult.status === "fulfilled" && statuses.find((s) => s.source === "KTC")?.ok && statuses.find((s) => s.source === "STATSGUY")?.ok) {
    statsGuyCalibrationPairs = await calibrateStatsGuyToKtc(refreshRunId, ktcResult.value, sgResult.value);
  }
  const consensusPlayersStored = statuses.find((s) => s.source === "KTC")?.ok ? await buildConsensus(refreshRunId) : 0;
  return {
    statuses,
    consensusPlayersStored,
    marketObservationsStored: statuses.reduce((sum, s) => sum + s.rowsStored, 0),
    draftPickObservationsStored: pickStored,
    fantasyCalcCalibrationPairs,
    statsGuyCalibrationPairs,
  };
}

export interface CurrentMarketMix {
  playerId: string;
  consensusValue: number | null;
  consensusObservedAt: string | null;
  consensusSourceCount: number;
  consensusSources: string[];
  ktcValue: number | null;
  fantasyCalcValue: number | null;
  fantasyCalcRawValue: number | null;
  statsGuyValue: number | null;
  statsGuyRawValue: number | null;
}

export async function getCurrentMarketMix(playerIds: string[]): Promise<Map<string, CurrentMarketMix>> {
  const result = new Map<string, CurrentMarketMix>();
  for (const playerId of playerIds) result.set(playerId, { playerId, consensusValue: null, consensusObservedAt: null, consensusSourceCount: 0, consensusSources: [], ktcValue: null, fantasyCalcValue: null, fantasyCalcRawValue: null, statsGuyValue: null, statsGuyRawValue: null });
  if (!playerIds.length) return result;
  const [consensus, market] = await Promise.all([
    marketDb.consensusObservation.findMany({ where: { playerId: { in: playerIds } }, orderBy: { observedAt: "desc" } }),
    marketDb.marketObservation.findMany({ where: { playerId: { in: playerIds } }, orderBy: { observedAt: "desc" } }),
  ]);
  const seenConsensus = new Set<string>();
  for (const c of consensus as any[]) {
    if (seenConsensus.has(c.playerId) || Date.now() - c.observedAt.getTime() > MARKET_SOURCE_MAX_AGE_MS) continue;
    let sources: string[] = []; try { sources = JSON.parse(c.sourcesUsed); } catch {}
    if (!sources.includes("KTC")) continue;
    seenConsensus.add(c.playerId);
    const row = result.get(c.playerId)!;
    row.consensusValue = c.value;
    row.consensusObservedAt = c.observedAt.toISOString();
    row.consensusSourceCount = c.sourceCount;
    row.consensusSources = sources;
  }
  const seenSource = new Set<string>();
  for (const m of market as any[]) {
    if (!["KTC", "FANTASYCALC", "STATSGUY"].includes(m.source)) continue;
    const key = `${m.playerId}:${m.source}`;
    if (seenSource.has(key)) continue;
    const anchor = m.sourceUpdatedAt ?? m.observedAt;
    if (Date.now() - anchor.getTime() > MARKET_SOURCE_MAX_AGE_MS) continue;
    seenSource.add(key);
    const row = result.get(m.playerId)!;
    if (m.source === "KTC") row.ktcValue = m.rawValue;
    if (m.source === "FANTASYCALC") { row.fantasyCalcRawValue = m.rawValue; row.fantasyCalcValue = m.normalizedValue; }
    if (m.source === "STATSGUY") { row.statsGuyRawValue = m.rawValue; row.statsGuyValue = m.normalizedValue; }
  }
  return result;
}

export async function getLatestMarketSourceStatuses(): Promise<Record<MarketSourceKey, { observedAt:string|null; sourceUpdatedAt:string|null; ageMs:number|null; stale:boolean }>> {
  const out = {} as Record<MarketSourceKey, {observedAt:string|null;sourceUpdatedAt:string|null;ageMs:number|null;stale:boolean}>;
  for (const source of ["KTC", "FANTASYCALC", "STATSGUY"] as MarketSourceKey[]) {
    const obs = await marketDb.marketObservation.findFirst({ where: { source }, orderBy: { observedAt: "desc" } });
    const anchor = obs?.sourceUpdatedAt ?? obs?.observedAt ?? null;
    const ageMs = anchor ? Date.now() - anchor.getTime() : null;
    out[source] = { observedAt: obs?.observedAt.toISOString() ?? null, sourceUpdatedAt: obs?.sourceUpdatedAt?.toISOString() ?? null, ageMs, stale: ageMs === null || ageMs > MARKET_SOURCE_MAX_AGE_MS };
  }
  return out;
}
