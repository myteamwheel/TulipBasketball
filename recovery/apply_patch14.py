from pathlib import Path
import re

ROOT = Path('recovered-app')

# ---------------- config.ts ----------------
p = ROOT / 'src/lib/config.ts'
s = p.read_text()
s = s.replace(
    'export const STATSGUY_REFRESH_ENABLED = process.env.STATSGUY_REFRESH_ENABLED !== "false";\n',
    'export const FANTASYCALC_REFRESH_ENABLED = process.env.FANTASYCALC_REFRESH_ENABLED !== "false";\n'
    '// Stats Guy remains available for diagnostics only. It is OFF by default and never\n'
    '// participates in consensus unless this implementation is intentionally revisited.\n'
    'export const STATSGUY_REFRESH_ENABLED = process.env.STATSGUY_REFRESH_ENABLED === "true";\n'
)
s = re.sub(
    r'export const CONSENSUS_WEIGHTS = \{\n\s*KTC: 0\.75,\n\s*STATSGUY: 0\.25,\n\} as const;',
    'export const CONSENSUS_WEIGHTS = {\n  KTC: 0.80,\n  FANTASYCALC: 0.20,\n  STATSGUY: 0.00,\n} as const;\n\n'
    '// A secondary market can disagree with KTC, but it must never manufacture the\n'
    '// primary value. Large disagreements are surfaced as review flags and excluded\n'
    '// from consensus rather than averaged blindly.\n'
    'export const SECONDARY_DISAGREEMENT_ABS = 500;\n'
    'export const SECONDARY_DISAGREEMENT_REL = 0.50;',
    s,
)
p.write_text(s)

# ---------------- marketSources.ts ----------------
p = ROOT / 'src/lib/marketSources.ts'
s = p.read_text()

s = s.replace(
    '  KTC_DIRECT_REFRESH_ENABLED,\n  MARKET_SOURCE_MAX_AGE_MS,\n  STATSGUY_REFRESH_ENABLED,\n',
    '  KTC_DIRECT_REFRESH_ENABLED,\n  MARKET_SOURCE_MAX_AGE_MS,\n  FANTASYCALC_REFRESH_ENABLED,\n  STATSGUY_REFRESH_ENABLED,\n  SECONDARY_DISAGREEMENT_ABS,\n  SECONDARY_DISAGREEMENT_REL,\n'
)
s = s.replace('export type MarketSourceKey = "KTC" | "STATSGUY";', 'export type MarketSourceKey = "KTC" | "FANTASYCALC" | "STATSGUY";')
s = s.replace('  statsGuyCalibrationPairs: number;\n}', '  fantasyCalcCalibrationPairs: number;\n  statsGuyCalibrationPairs: number;\n}')
s = s.replace(
    'const KTC_URL = "https://keeptradecut.com/dynasty-rankings";\nconst STATSGUY_URL = "https://api.statsguyfantasy.com/api/v1/players";',
    'const KTC_URL = "https://keeptradecut.com/dynasty-rankings";\n'
    'const FANTASYCALC_URL = "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5&includeAdp=false";\n'
    'const STATSGUY_URL = "https://api.statsguyfantasy.com/api/v1/players";'
)

# Replace KTC fetch with paginated public-page coverage. No auth/challenge bypasses.
ktc_fn = r'''export async function fetchKtcSnapshot(): Promise<ProviderSnapshot> {
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

interface StatsGuyPlayer'''
s = re.sub(r'export async function fetchKtcSnapshot\(\): Promise<ProviderSnapshot> \{.*?\n\}\n\ninterface StatsGuyPlayer', ktc_fn, s, flags=re.S)

# Add FantasyCalc persistence beside Stats Guy persistence.
marker = 'async function persistStatsGuy(snapshot: ProviderSnapshot, refreshRunId: string): Promise<number> {'
fc_persist = r'''async function persistFantasyCalc(snapshot: ProviderSnapshot, refreshRunId: string): Promise<number> {
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

'''
s = s.replace(marker, fc_persist + marker)

# Replace the StatsGuy-specific calibration with a generic secondary calibrator.
calibration = r'''async function calibrateSecondaryToKtc(
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

async function buildConsensus'''
s = re.sub(r'async function calibrateStatsGuyToKtc\(.*?\n\}\n\nasync function buildConsensus', calibration, s, flags=re.S)

# Consensus: KTC required. FantasyCalc may confirm it, but large disagreement is excluded.
consensus = r'''async function buildConsensus(refreshRunId: string, observedAt = new Date()): Promise<number> {
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

function disabledStatus'''
s = re.sub(r'async function buildConsensus\(refreshRunId: string, observedAt = new Date\(\)\): Promise<number> \{.*?\n\}\n\nfunction disabledStatus', consensus, s, flags=re.S)

# Refresh orchestration: KTC + FantasyCalc, StatsGuy optional diagnostic only.
refresh_fn = r'''export async function refreshLiveMarketSources(refreshRunId: string): Promise<MarketRefreshResult> {
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

export interface CurrentMarketMix'''
s = re.sub(r'export async function refreshLiveMarketSources\(refreshRunId: string\): Promise<MarketRefreshResult> \{.*?\n\}\n\nexport interface CurrentMarketMix', refresh_fn, s, flags=re.S)

# Reader model supports KTC-only consensus and FantasyCalc.
reader = r'''export interface CurrentMarketMix {
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

export async function getLatestMarketSourceStatuses'''
s = re.sub(r'export interface CurrentMarketMix \{.*?\n\}\n\nexport async function getLatestMarketSourceStatuses', reader, s, flags=re.S)

# Status endpoint knows all three sources.
s = re.sub(
    r'export async function getLatestMarketSourceStatuses\(\): Promise<Record<MarketSourceKey, \{ observedAt:string\|null; sourceUpdatedAt:string\|null; ageMs:number\|null; stale:boolean \}>> \{.*?\n\}',
    '''export async function getLatestMarketSourceStatuses(): Promise<Record<MarketSourceKey, { observedAt:string|null; sourceUpdatedAt:string|null; ageMs:number|null; stale:boolean }>> {\n  const out = {} as Record<MarketSourceKey, {observedAt:string|null;sourceUpdatedAt:string|null;ageMs:number|null;stale:boolean}>;\n  for (const source of ["KTC", "FANTASYCALC", "STATSGUY"] as MarketSourceKey[]) {\n    const obs = await marketDb.marketObservation.findFirst({ where: { source }, orderBy: { observedAt: "desc" } });\n    const anchor = obs?.sourceUpdatedAt ?? obs?.observedAt ?? null;\n    const ageMs = anchor ? Date.now() - anchor.getTime() : null;\n    out[source] = { observedAt: obs?.observedAt.toISOString() ?? null, sourceUpdatedAt: obs?.sourceUpdatedAt?.toISOString() ?? null, ageMs, stale: ageMs === null || ageMs > MARKET_SOURCE_MAX_AGE_MS };\n  }\n  return out;\n}''',
    s,
    flags=re.S,
)
p.write_text(s)

# ---------------- refresh API capability report ----------------
p = ROOT / 'src/app/api/refresh/route.ts'
s = p.read_text()
s = s.replace(
    'import { AUTO_REFRESH_ON_VISIT, KTC_DIRECT_REFRESH_ENABLED, MARKET_SOURCE_MAX_AGE_HOURS, STATSGUY_REFRESH_ENABLED } from "@/lib/config";',
    'import { AUTO_REFRESH_ON_VISIT, KTC_DIRECT_REFRESH_ENABLED, MARKET_SOURCE_MAX_AGE_HOURS, FANTASYCALC_REFRESH_ENABLED, STATSGUY_REFRESH_ENABLED } from "@/lib/config";'
)
s = s.replace(
    'sources: { KTC: KTC_DIRECT_REFRESH_ENABLED, STATSGUY: STATSGUY_REFRESH_ENABLED },',
    'sources: { KTC: KTC_DIRECT_REFRESH_ENABLED, FANTASYCALC: FANTASYCALC_REFRESH_ENABLED, STATSGUY_DIAGNOSTIC: STATSGUY_REFRESH_ENABLED },'
)
p.write_text(s)

# ---------------- refresh requested source labels ----------------
p = ROOT / 'src/lib/refresh.ts'
s = p.read_text()
s = s.replace(
    'const requestedSources = ["sleeper", "ktc", "statsguy", "consensus", "nflverse-context"];',
    'const requestedSources = ["sleeper", "ktc", "fantasycalc", "consensus", "nflverse-context"];'
)
p.write_text(s)

# ---------------- Settings marker + source-trust explanation ----------------
p = ROOT / 'src/app/(app)/settings/page.tsx'
s = p.read_text()
s = s.replace('SOURCE TRUST + WAIVER CALIBRATION PATCH 12', 'MARKET INTEGRITY + RECOVERY PATCH 14')
s = s.replace('Stats Guy', 'Stats Guy (diagnostic)')
p.write_text(s)

print('Patch 14 transformations applied')
