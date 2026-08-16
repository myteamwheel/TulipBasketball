import { prisma } from "@/lib/prisma";
import { normalizePlayerName } from "@/lib/normalize";
import { CONSENSUS_WEIGHTS, MARKET_SOURCE_MAX_AGE_MS } from "@/lib/config";

const TRADYR_PLAYERS_URL = "https://api.tradyr.app/v1/players?format=dynasty&numQbs=2&tep=false&limit=1000";
const TRUST_BAND = 0.75; // Above this, disagreement is diagnostic rather than consensus evidence.

type AnyObj = Record<string, unknown>;

type TradyrStatus = {
  source: "TRADYR";
  enabled: boolean;
  ok: boolean;
  eligibleForConsensus: boolean;
  fetchedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceAgeMs: number | null;
  rowsReceived: number;
  rowsStored: number;
  message: string;
};

export type TradyrRefreshResult = {
  status: TradyrStatus;
  observationsStored: number;
  consensusPlayersStored: number;
  calibrationPairs: number;
};

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function sourceAge(sourceUpdatedAt: Date, now = new Date()): number {
  return Math.max(0, now.getTime() - sourceUpdatedAt.getTime());
}

function assertFresh(sourceUpdatedAt: Date, now = new Date()): void {
  if (!Number.isFinite(sourceUpdatedAt.getTime())) throw new Error("Tradyr did not provide a valid generatedAt timestamp");
  const age = sourceAge(sourceUpdatedAt, now);
  if (age > MARKET_SOURCE_MAX_AGE_MS) throw new Error(`Tradyr data is ${(age / 3600000).toFixed(1)}h old and exceeds the freshness cutoff`);
}

function num(...values: unknown[]): number | null {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function str(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function playerRows(data: unknown): AnyObj[] {
  if (Array.isArray(data)) return data.filter((x): x is AnyObj => !!x && typeof x === "object");
  if (data && typeof data === "object") {
    const obj = data as AnyObj;
    for (const key of ["players", "rankings", "items", "values"]) {
      const arr = obj[key];
      if (Array.isArray(arr)) return arr.filter((x): x is AnyObj => !!x && typeof x === "object");
    }
  }
  return [];
}

async function currentLeaguePlayers() {
  const entries = await prisma.ownershipInterval.findMany({ where: { validTo: null }, include: { player: true } });
  return [...new Map(entries.map((e) => [e.player.id, e.player])).values()];
}

type ProviderRow = {
  sleeperId?: string;
  name: string;
  position: string;
  team?: string;
  rawValue: number;
  rank?: number;
  positionRank?: number;
  metadata?: Record<string, unknown>;
};

async function fetchTradyrRows(): Promise<{ fetchedAt: Date; sourceUpdatedAt: Date; rows: ProviderRow[]; meta: AnyObj }> {
  const fetchedAt = new Date();
  const headers: Record<string, string> = { Accept: "application/json", "Cache-Control": "no-cache" };
  if (process.env.TRADYR_API_KEY) headers.Authorization = `Bearer ${process.env.TRADYR_API_KEY}`;
  const response = await fetch(TRADYR_PLAYERS_URL, { cache: "no-store", signal: withTimeout(25000), headers });
  if (!response.ok) throw new Error(`Tradyr API failed (${response.status})`);
  const body = await response.json() as AnyObj;
  const meta = (body.meta && typeof body.meta === "object" ? body.meta : {}) as AnyObj;
  const sourceUpdatedAt = new Date(str(meta.generatedAt, meta.updatedAt, meta.timestamp) ?? fetchedAt.toISOString());
  assertFresh(sourceUpdatedAt, fetchedAt);
  const rows = playerRows(body.data).flatMap((row, index): ProviderRow[] => {
    const name = str(row.name, row.fullName, row.playerName);
    const position = str(row.position, row.pos)?.toUpperCase();
    const rawValue = num(row.composite, row.value, row.tradyrValue, row.tv, row.score);
    if (!name || !position || !["QB", "RB", "WR", "TE"].includes(position) || rawValue === null) return [];
    const sleeperId = str(row.sleeperId, row.sleeper_id, row.sleeper_player_id, row.player_id, row.id);
    return [{
      sleeperId,
      name,
      position,
      team: str(row.team, row.nflTeam),
      rawValue: Math.round(rawValue),
      rank: num(row.rank, row.overallRank) ?? index + 1,
      positionRank: num(row.positionRank, row.posRank) ?? undefined,
      metadata: {
        slug: str(row.slug),
        confidence: num(row.confidence, row.confidencePct),
        sources: meta.sources ?? row.sources ?? null,
        generatedAt: sourceUpdatedAt.toISOString(),
        apiVersion: meta.version ?? null,
        attribution: meta.attribution ?? "Powered by Tradyr",
      },
    }];
  });
  if (rows.length < 200) throw new Error(`Tradyr returned only ${rows.length} valued players; refusing partial snapshot`);
  return { fetchedAt, sourceUpdatedAt, rows, meta };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx), t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

type QuantileMap = { xs: number[]; ys: number[]; pairCount: number };
function buildQuantileMap(pairs: { raw: number; ktc: number }[]): QuantileMap | null {
  if (pairs.length < 12) return null;
  const raw = pairs.map((p) => p.raw).sort((a, b) => a - b);
  const ktc = pairs.map((p) => p.ktc).sort((a, b) => a - b);
  const qs = [0, .05, .1, .2, .3, .4, .5, .6, .7, .8, .9, .95, 1];
  const xs: number[] = [], ys: number[] = [];
  for (const q of qs) {
    const x = quantile(raw, q), y = quantile(ktc, q);
    if (xs.length && Math.abs(x - xs[xs.length - 1]) < 1e-9) { ys[ys.length - 1] = Math.max(ys[ys.length - 1], y); continue; }
    xs.push(x); ys.push(y);
  }
  return xs.length >= 2 ? { xs, ys, pairCount: pairs.length } : null;
}

function applyQuantileMap(map: QuantileMap, value: number): { value: number; extrapolated: boolean } {
  const { xs, ys } = map;
  if (value <= xs[0]) return { value: Math.max(0, Math.round(ys[0] * Math.max(0, value) / Math.max(1, xs[0]))), extrapolated: value < xs[0] };
  if (value >= xs[xs.length - 1]) return { value: Math.min(10000, Math.round(ys[ys.length - 1])), extrapolated: value > xs[xs.length - 1] };
  for (let i = 1; i < xs.length; i++) {
    if (value <= xs[i]) {
      const t = (value - xs[i - 1]) / Math.max(1e-9, xs[i] - xs[i - 1]);
      return { value: Math.round(ys[i - 1] + t * (ys[i] - ys[i - 1])), extrapolated: false };
    }
  }
  return { value: Math.round(ys[ys.length - 1]), extrapolated: false };
}

async function persistTradyr(refreshRunId: string, rows: ProviderRow[], fetchedAt: Date, sourceUpdatedAt: Date): Promise<number> {
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
  for (const row of rows) {
    let player = row.sleeperId ? bySleeper.get(row.sleeperId) : undefined;
    if (!player) {
      const candidates = byNamePos.get(`${normalizePlayerName(row.name)}|${row.position}`) ?? [];
      if (candidates.length === 1) player = candidates[0];
    }
    if (!player || seen.has(player.id)) continue;
    seen.add(player.id);
    try {
      await prisma.marketObservation.create({ data: {
        playerId: player.id,
        source: "TRADYR" as any,
        rawValue: row.rawValue,
        normalizedValue: 0,
        observedAt: fetchedAt,
        sourceUpdatedAt,
        sourceUrl: TRADYR_PLAYERS_URL,
        refreshRunId,
        sourceRank: row.rank,
        positionRank: row.positionRank,
        metadata: JSON.stringify({ ...(row.metadata ?? {}), scale: "TRADYR_RAW_PENDING_KTC_CALIBRATION" }),
      }} as any);
      stored++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("unique")) throw err;
    }
  }
  return stored;
}

async function calibrateTradyr(refreshRunId: string): Promise<number> {
  const rows = await prisma.marketObservation.findMany({ where: { refreshRunId, source: { in: ["KTC", "TRADYR" as any] } } as any, include: { player: { select: { position: true } } } as any });
  const ktcByPlayer = new Map<string, any>();
  const tradyrRows: any[] = [];
  for (const row of rows as any[]) {
    if (row.source === "KTC") ktcByPlayer.set(row.playerId, row);
    if (row.source === "TRADYR") tradyrRows.push(row);
  }
  const pairs = tradyrRows.flatMap((row) => {
    const ktc = ktcByPlayer.get(row.playerId);
    return ktc ? [{ raw: row.rawValue, ktc: ktc.rawValue }] : [];
  });
  const map = buildQuantileMap(pairs);
  if (!map) return 0;
  for (const row of tradyrRows) {
    const converted = applyQuantileMap(map, row.rawValue);
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.metadata || "{}"); } catch {}
    await prisma.marketObservation.update({ where: { id: row.id }, data: {
      normalizedValue: converted.value,
      metadata: JSON.stringify({ ...meta, scale: "KTC_EQUIVALENT", sourceName: "TRADYR", scaleMethod: "LEAGUE_OVERLAP_QUANTILE_MAP", calibrationPairs: map.pairCount, rawSourceValue: row.rawValue, ktcEquivalentValue: converted.value, calibrationExtrapolated: converted.extrapolated }),
    } as any });
  }
  return pairs.length;
}

async function rebuildConsensus(refreshRunId: string, observedAt = new Date()): Promise<number> {
  const observations = await prisma.marketObservation.findMany({ where: { refreshRunId, source: { in: ["KTC", "TRADYR" as any, "DYNASTYDEALER" as any] } } as any });
  const byPlayer = new Map<string, any[]>();
  for (const obs of observations as any[]) { const list = byPlayer.get(obs.playerId) ?? []; list.push(obs); byPlayer.set(obs.playerId, list); }
  let stored = 0;
  for (const [playerId, list] of byPlayer) {
    const fresh = list.filter((o) => {
      const anchor = o.sourceUpdatedAt ?? o.observedAt;
      return observedAt.getTime() - anchor.getTime() <= MARKET_SOURCE_MAX_AGE_MS;
    });
    const ktc = fresh.find((o) => o.source === "KTC");
    if (!ktc) continue;
    const weighted: { obs: any; base: number; reliability: number }[] = [{ obs: ktc, base: CONSENSUS_WEIGHTS.KTC, reliability: 1 }];
    for (const obs of fresh.filter((o) => o.source !== "KTC")) {
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(obs.metadata || "{}"); } catch {}
      if (meta.scale !== "KTC_EQUIVALENT" || meta.calibrationExtrapolated === true) continue;
      const gap = Math.abs(obs.normalizedValue - ktc.normalizedValue) / Math.max(1, Math.abs(ktc.normalizedValue));
      if (gap > TRUST_BAND) continue;
      const base = obs.source === "TRADYR" ? (CONSENSUS_WEIGHTS as any).TRADYR ?? 0.20 : obs.source === "DYNASTYDEALER" ? (CONSENSUS_WEIGHTS as any).DYNASTYDEALER ?? 0.10 : 0;
      if (base <= 0) continue;
      weighted.push({ obs, base, reliability: gap > 0.50 ? 0.35 : gap > 0.25 ? 0.65 : 1 });
    }
    const denom = weighted.reduce((sum, x) => sum + x.base * x.reliability, 0);
    if (denom <= 0) continue;
    const weights: Record<string, number> = {};
    let value = 0;
    for (const item of weighted) {
      const w = item.base * item.reliability / denom;
      weights[item.obs.source] = w;
      value += item.obs.normalizedValue * w;
    }
    const sources = weighted.map((x) => x.obs.source);
    await prisma.consensusObservation.upsert({
      where: { playerId_refreshRunId: { playerId, refreshRunId } },
      update: { value: Math.round(value), observedAt, sourcesUsed: JSON.stringify(sources), sourceCount: sources.length, weights: JSON.stringify(weights) },
      create: { playerId, refreshRunId, value: Math.round(value), observedAt, sourcesUsed: JSON.stringify(sources), sourceCount: sources.length, weights: JSON.stringify(weights) },
    });
    stored++;
  }
  return stored;
}

export async function refreshTradyrSource(refreshRunId: string): Promise<TradyrRefreshResult> {
  const fetchedAt = new Date();
  try {
    const snapshot = await fetchTradyrRows();
    const stored = await persistTradyr(refreshRunId, snapshot.rows, snapshot.fetchedAt, snapshot.sourceUpdatedAt);
    const pairs = await calibrateTradyr(refreshRunId);
    const consensus = await rebuildConsensus(refreshRunId, snapshot.fetchedAt);
    return {
      status: { source: "TRADYR", enabled: true, ok: true, eligibleForConsensus: true, fetchedAt: snapshot.fetchedAt.toISOString(), sourceUpdatedAt: snapshot.sourceUpdatedAt.toISOString(), sourceAgeMs: sourceAge(snapshot.sourceUpdatedAt, snapshot.fetchedAt), rowsReceived: snapshot.rows.length, rowsStored: stored, message: `Tradyr public API; ${snapshot.rows.length} players; ${pairs} same-refresh overlap pairs translated to KTC scale; consensus rebuilt with KTC anchor.` },
      observationsStored: stored,
      consensusPlayersStored: consensus,
      calibrationPairs: pairs,
    };
  } catch (err) {
    return {
      status: { source: "TRADYR", enabled: true, ok: false, eligibleForConsensus: false, fetchedAt: fetchedAt.toISOString(), sourceUpdatedAt: null, sourceAgeMs: null, rowsReceived: 0, rowsStored: 0, message: err instanceof Error ? err.message : String(err) },
      observationsStored: 0,
      consensusPlayersStored: 0,
      calibrationPairs: 0,
    };
  }
}
