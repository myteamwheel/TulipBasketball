import { prisma } from "@/lib/prisma";
import { normalizePlayerName } from "@/lib/normalize";
import {
  CONSENSUS_TRUSTED_SOURCES,
  CONSENSUS_WEIGHTS,
  DYNASTY_DEALER_REFRESH_ENABLED,
  FANTASYCALC_REFRESH_ENABLED,
  KTC_DIRECT_REFRESH_ENABLED,
  MARKET_SOURCE_MAX_AGE_MS,
  SECONDARY_KTC_DIVERGENCE_LIMIT,
  SLEEPER_LEAGUE_ID,
  STATSGUY_REFRESH_ENABLED,
  TRADYR_REFRESH_ENABLED,
} from "@/lib/config";
import { commitKtcImport, type KtcImportRow } from "@/lib/ktcImport";

export type MarketSourceKey =
  | "KTC"
  | "TRADYR"
  | "DYNASTY_DEALER"
  | "FANTASYCALC"
  | "STATSGUY";
export type TrustedMarketSourceKey = "KTC" | "TRADYR" | "DYNASTY_DEALER";
const marketDb = prisma;

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
const TRADYR_BASE_URL = "https://api.tradyr.app/v1/players";
const TRADYR_SOURCE_URL =
  "https://api.tradyr.app/v1/players?format=dynasty&numQbs=2&tep=false";
const DYNASTY_DEALER_URL = "https://www.dynastydealer.com/api/player-values";
const DYNASTY_DEALER_ATTRIBUTION_URL = "https://www.dynastydealer.com/";
const FANTASYCALC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5";
const FANTASYCALC_CADENCE_URL = "https://fantasycalc.com/trade-value-chart";
const FANTASYCALC_HOME_URL = "https://fantasycalc.com/";
const STATSGUY_URL = "https://api.statsguyfantasy.com/api/v1/players";
const MIN_PROVIDER_ROWS = 200;

function sourceAge(sourceUpdatedAt: Date, now = new Date()): number {
  return Math.max(0, now.getTime() - sourceUpdatedAt.getTime());
}

function assertFresh(
  source: string,
  sourceUpdatedAt: Date,
  now = new Date(),
): void {
  const age = sourceAge(sourceUpdatedAt, now);
  if (!Number.isFinite(sourceUpdatedAt.getTime()))
    throw new Error(`${source} did not provide a valid update timestamp`);
  if (age > MARKET_SOURCE_MAX_AGE_MS) {
    const hours = (age / 3600000).toFixed(1);
    throw new Error(
      `${source} data is ${hours}h old and exceeds the freshness cutoff; excluded`,
    );
  }
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function parseKtcFreshness(html: string, fetchedAt: Date): Date {
  if (/Values updated\s+(?:just now|moments ago)/i.test(html)) return fetchedAt;
  const m = html.match(
    /Values updated\s+(\d+)\s+(second|minute|hour|day)s?\s+ago/i,
  );
  if (!m)
    throw new Error(
      "KTC freshness timestamp was not found; refusing to treat the page as current",
    );
  const amount = Number(m[1]);
  const unit = m[2].toLowerCase();
  const unitMs =
    unit === "second"
      ? 1000
      : unit === "minute"
        ? 60000
        : unit === "hour"
          ? 3600000
          : 86400000;
  return new Date(fetchedAt.getTime() - amount * unitMs);
}

function extractJsonArrayAfterMarker(
  html: string,
  marker: RegExp,
): unknown[] | null {
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
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        const raw = html.slice(open, i + 1);
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractKtcPlayers(html: string): unknown[] {
  // KTC currently embeds the full dynasty player universe in a page-level
  // JavaScript array. Use a balanced-bracket parser rather than a lazy regex so
  // nested objects/arrays or strings cannot truncate the payload.
  const markers = [
    /\bvar\s+playersArray\s*=\s*/,
    /\blet\s+playersArray\s*=\s*/,
    /\bconst\s+playersArray\s*=\s*/,
  ];
  for (const marker of markers) {
    const parsed = extractJsonArrayAfterMarker(html, marker);
    if (parsed && parsed.length > 0) return parsed;
  }
  throw new Error(
    "KTC full playersArray was not found; page structure may have changed",
  );
}

function parseKtcValue(
  player: Record<string, unknown>,
): { value: number; rank?: number; positionRank?: number } | null {
  const bucket = player.superflexValues;
  if (!bucket || typeof bucket !== "object") return null;
  const b = bucket as Record<string, unknown>;

  // KTC has used both a direct leaf shape and a nested `value` leaf for
  // no-TE-premium values. Accept either without ever falling back to 1QB.
  const candidates: Record<string, unknown>[] = [];
  if (b.value && typeof b.value === "object")
    candidates.push(b.value as Record<string, unknown>);
  candidates.push(b);

  for (const candidate of candidates) {
    const value = Number(candidate.value);
    if (!Number.isFinite(value) || value <= 0 || value > 10000) continue;
    const rankRaw = candidate.overallRank ?? candidate.rank;
    const posRaw = candidate.positionalRank ?? candidate.positionRank;
    const rank = Number(rankRaw);
    const positionRank = Number(posRaw);
    return {
      value: Math.round(value),
      rank: Number.isFinite(rank) ? Math.round(rank) : undefined,
      positionRank: Number.isFinite(positionRank)
        ? Math.round(positionRank)
        : undefined,
    };
  }
  return null;
}

export async function fetchKtcSnapshot(): Promise<ProviderSnapshot> {
  const fetchedAt = new Date();
  const response = await fetch(KTC_URL, {
    cache: "no-store",
    signal: withTimeout(30000),
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
      // Use an ordinary browser UA because the public rankings page serves its
      // complete embedded data to browsers. No authentication or challenge
      // bypass is attempted.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok)
    throw new Error(`KTC public rankings request failed (${response.status})`);
  const html = await response.text();
  if (html.length < 10000)
    throw new Error(
      `KTC returned an unexpectedly small page (${html.length} bytes)`,
    );
  const sourceUpdatedAt = parseKtcFreshness(html, fetchedAt);
  assertFresh("KTC", sourceUpdatedAt, fetchedAt);

  const players = extractKtcPlayers(html);
  const rows: ProviderRow[] = [];
  for (const raw of players) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const v = parseKtcValue(p);
    if (!v) continue;
    const name = String(p.playerName ?? p.name ?? "").trim();
    if (!name) continue;
    rows.push({
      ktcId: String(p.playerID ?? p.id ?? "").trim() || undefined,
      name,
      position:
        String(p.position ?? "")
          .trim()
          .toUpperCase() || undefined,
      team: String(p.team ?? "").trim() || undefined,
      rawValue: v.value,
      rank: v.rank,
      positionRank: v.positionRank,
      metadata: { age: p.age ?? null },
    });
  }
  if (rows.length < MIN_PROVIDER_ROWS)
    throw new Error(
      `KTC returned only ${rows.length} valued players; refusing partial snapshot`,
    );
  return {
    source: "KTC",
    sourceUrl: KTC_URL,
    fetchedAt,
    sourceUpdatedAt,
    rows,
    message: `KTC live public rankings; ${rows.length} valued players; page updated ${Math.round(sourceAge(sourceUpdatedAt, fetchedAt) / 60000)}m before this refresh`,
  };
}

interface TradyrMeta {
  generatedAt?: string;
  sources?: unknown;
  attribution?: string;
  version?: string;
  total?: number;
  limit?: number;
  offset?: number;
  access?: {
    limited?: boolean;
    returned?: number;
    total?: number;
    reason?: string;
    message?: string;
  };
}

interface TradyrPayload {
  data?: Array<Record<string, unknown>>;
  meta?: TradyrMeta;
}

function tradyrPageUrl(offset: number, limit = 50): string {
  const url = new URL(TRADYR_BASE_URL);
  url.searchParams.set("format", "dynasty");
  url.searchParams.set("numQbs", "2");
  url.searchParams.set("tep", "false");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  return url.toString();
}

export async function fetchTradyrSnapshot(): Promise<ProviderSnapshot> {
  const fetchedAt = new Date();
  const pageSize = 50;
  const maxPages = 20;
  const allData: Array<Record<string, unknown>> = [];
  let latestMeta: TradyrMeta | undefined;
  let latestGeneratedAt: Date | null = null;
  let expectedTotal: number | null = null;
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const response = await fetch(tradyrPageUrl(offset, pageSize), {
      cache: "no-store",
      signal: withTimeout(20000),
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache, no-store, max-age=0",
        Pragma: "no-cache",
      },
    });
    if (!response.ok)
      throw new Error(
        `Tradyr public API failed (${response.status}) at offset ${offset}`,
      );

    const payload = (await response.json()) as TradyrPayload;
    const pageData = Array.isArray(payload.data) ? payload.data : [];
    const generatedAt = new Date(payload.meta?.generatedAt ?? "");
    if (!Number.isFinite(generatedAt.getTime())) {
      throw new Error(
        `Tradyr meta.generatedAt was missing or invalid at offset ${offset}`,
      );
    }
    if (!latestGeneratedAt || generatedAt > latestGeneratedAt)
      latestGeneratedAt = generatedAt;
    latestMeta = payload.meta ?? latestMeta;
    pagesFetched++;

    const totalCandidate = Number(
      payload.meta?.total ?? payload.meta?.access?.total,
    );
    if (Number.isFinite(totalCandidate) && totalCandidate > 0)
      expectedTotal = Math.round(totalCandidate);

    allData.push(...pageData);
    if (pageData.length === 0) break;
    if (expectedTotal != null && allData.length >= expectedTotal) break;
    if (pageData.length < pageSize) break;
  }

  if (!latestGeneratedAt)
    throw new Error("Tradyr did not provide a valid update timestamp");
  assertFresh("Tradyr", latestGeneratedAt, fetchedAt);
  if (expectedTotal != null && allData.length < expectedTotal) {
    throw new Error(
      `Tradyr pagination stopped at ${allData.length}/${expectedTotal} rows; refusing partial snapshot`,
    );
  }

  const deduped = new Map<string, Record<string, unknown>>();
  for (const raw of allData) {
    const sleeperCandidate = raw.sleeperId ?? raw.sleeper_id;
    const slug = String(raw.slug ?? "")
      .trim()
      .toLowerCase();
    const name = String(raw.name ?? "").trim();
    const position = String(raw.position ?? "")
      .trim()
      .toUpperCase();
    const key =
      sleeperCandidate != null
        ? `sleeper:${String(sleeperCandidate)}`
        : slug
          ? `slug:${slug}`
          : `name:${normalizePlayerName(name)}|${position}`;
    if (!deduped.has(key)) deduped.set(key, raw);
  }

  const rows: ProviderRow[] = Array.from(deduped.values()).flatMap(
    (raw, index) => {
      const name = String(raw.name ?? "").trim();
      const value = Number(raw.composite ?? raw.value);
      if (!name || !Number.isFinite(value) || value <= 0) return [];
      const sleeperCandidate = raw.sleeperId ?? raw.sleeper_id;
      return [
        {
          sleeperId:
            sleeperCandidate != null ? String(sleeperCandidate) : undefined,
          name,
          position:
            String(raw.position ?? "")
              .trim()
              .toUpperCase() || undefined,
          team: String(raw.team ?? "").trim() || undefined,
          rawValue: Math.round(value),
          // Tradyr's anonymous paginated response restarts `rank` on each page,
          // so use the full-board sequence after concatenation instead.
          rank: index + 1,
          positionRank: Number.isFinite(
            Number(raw.positionRank ?? raw.position_rank),
          )
            ? Number(raw.positionRank ?? raw.position_rank)
            : undefined,
          metadata: {
            confidence: raw.confidence ?? null,
            slug: raw.slug ?? null,
            sources: raw.sources ?? latestMeta?.sources ?? null,
            apiVersion: latestMeta?.version ?? null,
            attribution: latestMeta?.attribution ?? "Powered by Tradyr",
            anonymousPagination: true,
            pagesFetched,
          },
        },
      ];
    },
  );

  if (rows.length < MIN_PROVIDER_ROWS) {
    throw new Error(
      `Tradyr returned only ${rows.length} valued players after pagination; refusing partial snapshot`,
    );
  }
  if (
    expectedTotal != null &&
    rows.length < Math.min(expectedTotal, MIN_PROVIDER_ROWS)
  ) {
    throw new Error(
      `Tradyr produced only ${rows.length}/${expectedTotal} unique valued players; refusing incomplete snapshot`,
    );
  }

  return {
    source: "TRADYR",
    sourceUrl: TRADYR_SOURCE_URL,
    fetchedAt,
    sourceUpdatedAt: latestGeneratedAt,
    rows,
    message: `Tradyr public API; ${rows.length}${expectedTotal ? `/${expectedTotal}` : ""} dynasty-superflex players across ${pagesFetched} anonymous pages; generated ${latestGeneratedAt.toISOString()}`,
  };
}

interface DynastyDealerPayload {
  source?: string;
  players?: Array<Record<string, unknown>>;
  total?: number;
  timestamp?: string;
}

export async function fetchDynastyDealerSnapshot(): Promise<ProviderSnapshot> {
  const fetchedAt = new Date();
  const response = await fetch(DYNASTY_DEALER_URL, {
    cache: "no-store",
    signal: withTimeout(20000),
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
  if (!response.ok)
    throw new Error(`Dynasty Dealer public API failed (${response.status})`);
  const payload = (await response.json()) as DynastyDealerPayload;
  const rowsRaw = Array.isArray(payload.players) ? payload.players : [];
  const timestamps = [
    payload.timestamp,
    ...rowsRaw.slice(0, 100).map((r) => r.updated_at as string | undefined),
  ]
    .filter(Boolean)
    .map((x) => new Date(String(x)))
    .filter((d) => Number.isFinite(d.getTime()));
  const sourceUpdatedAt = timestamps.length
    ? new Date(Math.max(...timestamps.map((d) => d.getTime())))
    : new Date("");
  if (!Number.isFinite(sourceUpdatedAt.getTime()))
    throw new Error("Dynasty Dealer timestamp was missing or invalid");
  assertFresh("Dynasty Dealer", sourceUpdatedAt, fetchedAt);
  const rows: ProviderRow[] = rowsRaw.flatMap((raw) => {
    const name = String(raw.name ?? "").trim();
    const position = String(raw.position ?? "")
      .trim()
      .toUpperCase();
    const value = Number(raw.current_value ?? raw.base_value);
    // Pick rows are intentionally not persisted as Player observations; the
    // transaction layer consumes those separately.
    if (
      !name ||
      !["QB", "RB", "WR", "TE"].includes(position) ||
      !Number.isFinite(value) ||
      value <= 0
    )
      return [];
    return [
      {
        sleeperId: raw.sleeper_id != null ? String(raw.sleeper_id) : undefined,
        name,
        position,
        team: String(raw.team ?? "").trim() || undefined,
        rawValue: Math.round(value),
        metadata: {
          baseValue: raw.base_value ?? null,
          votes: raw.votes ?? null,
          voteRating: raw.vote_rating ?? null,
          voteImpactPercent: raw.vote_impact_percent ?? null,
          rowUpdatedAt: raw.updated_at ?? null,
          attributionUrl: DYNASTY_DEALER_ATTRIBUTION_URL,
        },
      },
    ];
  });
  if (rows.length < MIN_PROVIDER_ROWS)
    throw new Error(
      `Dynasty Dealer returned only ${rows.length} valued players; refusing partial snapshot`,
    );
  return {
    source: "DYNASTY_DEALER",
    sourceUrl: DYNASTY_DEALER_URL,
    fetchedAt,
    sourceUpdatedAt,
    rows,
    message: `Dynasty Dealer public API; ${rows.length} player assets; values from real Sleeper trades`,
  };
}

export interface DraftPickMarketValue {
  key: string;
  season: string;
  round: number;
  slot: number | null;
  label: string;
  value: number;
  source: "DYNASTY_DEALER" | "TRADYR";
  sourceUpdatedAt: string | null;
}

function parsePickDescriptor(
  name: string,
): { season: string; round: number; slot: number | null } | null {
  const text = name.trim();

  // Slot-level rows from Dynasty Dealer are documented in forms such as
  // "2027 1.03". Resolve these first so the slot is not lost.
  const slotMatch = text.match(/\b(20\d{2})\b.*?\b([1-7])\.(\d{1,2})\b/i);
  if (slotMatch) {
    const round = Number(slotMatch[2]);
    const slot = Number(slotMatch[3]);
    return {
      season: slotMatch[1],
      round,
      slot: slot >= 1 && slot <= 12 ? slot : null,
    };
  }

  // Generic and tiered rows: "2027 1st", "2027 Round 1 Early", etc.
  const roundMatch = text.match(
    /\b(20\d{2})\b.*?\b(1st|2nd|3rd|4th|5th|6th|7th|round\s*[1-7]|r[1-7])\b/i,
  );
  if (!roundMatch) return null;
  const season = roundMatch[1];
  const token = roundMatch[2].toLowerCase().replace(/\s+/g, "");
  const digit = token.match(/[1-7]/)?.[0];
  if (!digit) return null;
  return { season, round: Number(digit), slot: null };
}

/** Current pick prices used by transaction audit. No historical price is invented. */
export async function fetchCurrentDraftPickMarketValues(): Promise<
  DraftPickMarketValue[]
> {
  const response = await fetch(`${DYNASTY_DEALER_URL}?perSlot=true`, {
    next: { revalidate: 3600 },
    signal: withTimeout(20000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Dynasty Dealer pick values failed (${response.status})`);
  const payload = (await response.json()) as DynastyDealerPayload;
  const updated = payload.timestamp ?? null;
  const latestDealerObservation = await marketDb.marketObservation.findFirst({
    where: { source: "DYNASTY_DEALER" },
    orderBy: { observedAt: "desc" },
  });
  let scaleFactor = 1;
  try {
    const meta = latestDealerObservation?.metadata
      ? JSON.parse(latestDealerObservation.metadata)
      : {};
    const parsed = Number(meta.ktcScaleFactor);
    if (Number.isFinite(parsed) && parsed > 0.3 && parsed < 3)
      scaleFactor = parsed;
  } catch {}
  const out: DraftPickMarketValue[] = [];
  for (const raw of Array.isArray(payload.players) ? payload.players : []) {
    const name = String(raw.name ?? "").trim();
    const parsed = parsePickDescriptor(name);
    const value = Number(raw.current_value ?? raw.base_value);
    if (!parsed || !Number.isFinite(value) || value <= 0) continue;
    out.push({
      key: `${parsed.season}:${parsed.round}:${parsed.slot ?? "generic"}`,
      ...parsed,
      label: name,
      value: clampKtcScale(value * scaleFactor),
      source: "DYNASTY_DEALER",
      sourceUpdatedAt: updated,
    });
  }
  return out;
}

interface FantasyCalcItem {
  player?: {
    sleeperId?: string;
    name?: string;
    position?: string;
    maybeTeam?: string;
  };
  value?: number;
  overallRank?: number;
  positionRank?: number;
  trend30Day?: number;
}

function normalizeProviderPageText(html: string): string {
  // Provider marketing/freshness text is sometimes split by tags or embedded
  // inside serialized page data. Normalize both forms before matching.
  return html
    .replace(/\\u00a0/gi, " ")
    .replace(/\\u0020/gi, " ")
    .replace(/\\n|\\r|\\t/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFantasyCalcCadenceHours(...pages: string[]): number | null {
  for (const page of pages) {
    const text = normalizeProviderPageText(page);
    const explicit =
      text.match(
        /(?:automatically\s+)?updated\s+every\s+(\d+)\s*(?:hours?|hrs?)/i,
      ) ??
      text.match(/updates?\s+every\s+(\d+)\s*(?:hours?|hrs?)/i) ??
      text.match(
        /every\s+(\d+)\s*(?:hours?|hrs?)\s+(?:all\s+season|throughout\s+the\s+season)/i,
      );
    if (explicit) return Number(explicit[1]);
    // This language is weaker than an exact timestamp, but still expressly
    // promises more than one update per day. Treat it as a 12h upper-bound
    // only for the policy gate; empirical snapshot-change tracking below
    // prevents unchanged values from being perpetually marked fresh.
    if (/automatically\s+updated\s+multiple\s+times\s+per\s+day/i.test(text))
      return 12;
  }
  return null;
}

async function inferFantasyCalcFreshness(
  rows: ProviderRow[],
  fetchedAt: Date,
): Promise<{
  sourceUpdatedAt: Date;
  changedPlayers: number;
  comparedPlayers: number;
}> {
  // FantasyCalc's current-values endpoint does not expose a calculation
  // timestamp. To avoid treating a permanently cached payload as fresh just
  // because HTTP returned 200, compare the tracked-league values with the most
  // recent stored FantasyCalc observations. If the entire tracked dataset is
  // unchanged, retain the previous freshness anchor rather than resetting it.
  const leaguePlayers = await currentLeaguePlayers();
  const bySleeperId = new Map(leaguePlayers.map((p) => [p.sleeperId, p.id]));
  const currentByPlayer = new Map<string, number>();
  for (const row of rows) {
    if (!row.sleeperId) continue;
    const playerId = bySleeperId.get(row.sleeperId);
    if (playerId) currentByPlayer.set(playerId, row.rawValue);
  }
  if (currentByPlayer.size === 0)
    return {
      sourceUpdatedAt: fetchedAt,
      changedPlayers: 0,
      comparedPlayers: 0,
    };

  const previous = await marketDb.marketObservation.findMany({
    where: {
      source: "FANTASYCALC",
      playerId: { in: [...currentByPlayer.keys()] },
    },
    orderBy: { observedAt: "desc" },
    take: Math.max(currentByPlayer.size * 4, 800),
  });
  const latestByPlayer = new Map<string, (typeof previous)[number]>();
  for (const obs of previous)
    if (!latestByPlayer.has(obs.playerId))
      latestByPlayer.set(obs.playerId, obs);
  let comparedPlayers = 0;
  let changedPlayers = 0;
  let previousAnchor: Date | null = null;
  for (const [playerId, value] of currentByPlayer) {
    const prev = latestByPlayer.get(playerId);
    if (!prev) continue;
    comparedPlayers++;
    if (Number(prev.rawValue) !== value) changedPlayers++;
    const anchor = prev.sourceUpdatedAt ?? prev.observedAt;
    if (!previousAnchor || anchor > previousAnchor) previousAnchor = anchor;
  }
  // First usable snapshot, insufficient overlap, or any detected market change:
  // accept the current fetch as fresh. If hundreds of tracked values are
  // byte-for-byte unchanged, carry forward the prior freshness anchor so the
  // source will automatically age out after the configured cutoff.
  if (comparedPlayers < 50 || changedPlayers > 0 || !previousAnchor) {
    return { sourceUpdatedAt: fetchedAt, changedPlayers, comparedPlayers };
  }
  return { sourceUpdatedAt: previousAnchor, changedPlayers, comparedPlayers };
}

export async function fetchFantasyCalcSnapshot(): Promise<ProviderSnapshot> {
  const fetchedAt = new Date();
  // FantasyCalc publicly states that its trade-value chart updates every three
  // hours. Verify that <=24h promise on every refresh, using two public pages
  // so harmless markup changes on one page cannot falsely exclude the source.
  const [response, cadenceResult, homeResult] = await Promise.all([
    fetch(FANTASYCALC_URL, {
      cache: "no-store",
      signal: withTimeout(20000),
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache, no-store, max-age=0",
        Pragma: "no-cache",
      },
    }),
    fetch(FANTASYCALC_CADENCE_URL, {
      cache: "no-store",
      signal: withTimeout(20000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Cache-Control": "no-cache, no-store, max-age=0",
        Pragma: "no-cache",
      },
    })
      .then(async (r) => ({
        ok: r.ok,
        status: r.status,
        html: r.ok ? await r.text() : "",
      }))
      .catch(() => ({ ok: false, status: 0, html: "" })),
    fetch(FANTASYCALC_HOME_URL, {
      cache: "no-store",
      signal: withTimeout(20000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Cache-Control": "no-cache, no-store, max-age=0",
        Pragma: "no-cache",
      },
    })
      .then(async (r) => ({
        ok: r.ok,
        status: r.status,
        html: r.ok ? await r.text() : "",
      }))
      .catch(() => ({ ok: false, status: 0, html: "" })),
  ]);
  if (!response.ok)
    throw new Error(
      `FantasyCalc current-values request failed (${response.status})`,
    );
  if (!cadenceResult.ok && !homeResult.ok)
    throw new Error(
      `FantasyCalc freshness-policy pages were unavailable (${cadenceResult.status}/${homeResult.status})`,
    );
  const cadenceHours = parseFantasyCalcCadenceHours(
    cadenceResult.html,
    homeResult.html,
  );
  if (cadenceHours === null)
    throw new Error(
      "FantasyCalc public pages no longer provide a verifiable daily-or-better update cadence; excluded",
    );
  if (!Number.isFinite(cadenceHours) || cadenceHours > 24) {
    throw new Error(
      `FantasyCalc published update cadence is ${cadenceHours}h; exceeds daily freshness rule`,
    );
  }
  const data = (await response.json()) as FantasyCalcItem[];
  if (!Array.isArray(data))
    throw new Error("FantasyCalc returned an unexpected payload");
  const rows: ProviderRow[] = data.flatMap((item) => {
    const value = Number(item.value);
    const name = item.player?.name?.trim();
    if (!name || !Number.isFinite(value) || value <= 0) return [];
    return [
      {
        sleeperId: item.player?.sleeperId
          ? String(item.player.sleeperId)
          : undefined,
        name,
        position: item.player?.position,
        team: item.player?.maybeTeam,
        rawValue: Math.round(value),
        rank: Number.isFinite(Number(item.overallRank))
          ? Number(item.overallRank)
          : undefined,
        positionRank: Number.isFinite(Number(item.positionRank))
          ? Number(item.positionRank)
          : undefined,
        metadata: { trend30Day: item.trend30Day ?? null },
      },
    ];
  });
  if (rows.length < MIN_PROVIDER_ROWS)
    throw new Error(
      `FantasyCalc returned only ${rows.length} valued players; refusing partial snapshot`,
    );
  const empirical = await inferFantasyCalcFreshness(rows, fetchedAt);
  assertFresh("FantasyCalc", empirical.sourceUpdatedAt, fetchedAt);
  const ageMinutes = Math.round(
    sourceAge(empirical.sourceUpdatedAt, fetchedAt) / 60000,
  );
  return {
    source: "FANTASYCALC",
    sourceUrl: FANTASYCALC_URL,
    fetchedAt,
    sourceUpdatedAt: empirical.sourceUpdatedAt,
    rows,
    message: `FantasyCalc current endpoint; ${rows.length} valued players; published cadence ${cadenceHours}h; empirical tracked-market age ${ageMinutes}m (${empirical.changedPlayers}/${empirical.comparedPlayers} values changed vs prior snapshot)`,
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
  total?: number;
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
  if (!response.ok)
    throw new Error(`Stats Guy Fantasy API failed (${response.status})`);
  const data = (await response.json()) as StatsGuyResponse;
  const asOf = data.valuesAsOf?.sf_dynasty;
  if (!asOf)
    throw new Error("Stats Guy Fantasy did not return valuesAsOf.sf_dynasty");
  const sourceUpdatedAt = new Date(asOf);
  assertFresh("Stats Guy Fantasy", sourceUpdatedAt, fetchedAt);
  const players = Array.isArray(data.players) ? data.players : [];
  const rows: ProviderRow[] = players.flatMap((player) => {
    const value = Number(player.value?.sf_dynasty);
    const name = player.name?.trim();
    if (!player.id || !name || !Number.isFinite(value) || value <= 0) return [];
    return [
      {
        sleeperId: String(player.id),
        name,
        position: player.position,
        team: player.team,
        rawValue: Math.round(value),
        rank: Number.isFinite(Number(player.rank?.sf_dynasty))
          ? Number(player.rank?.sf_dynasty)
          : undefined,
        positionRank: Number.isFinite(Number(player.positionRank?.sf_dynasty))
          ? Number(player.positionRank?.sf_dynasty)
          : undefined,
        metadata: { valueChange: player.valueChange?.sf_dynasty ?? null },
      },
    ];
  });
  if (rows.length < MIN_PROVIDER_ROWS)
    throw new Error(
      `Stats Guy Fantasy returned only ${rows.length} valued players; refusing partial snapshot`,
    );
  return {
    source: "STATSGUY",
    sourceUrl: STATSGUY_URL,
    fetchedAt,
    sourceUpdatedAt,
    rows,
    message: `Stats Guy Fantasy official API; values as of ${sourceUpdatedAt.toISOString()}`,
  };
}

async function currentLeaguePlayers() {
  const entries = await prisma.ownershipInterval.findMany({
    where: {
      validTo: null,
      manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
    },
    include: { player: true },
  });
  const unique = new Map(entries.map((e) => [e.player.id, e.player]));
  return [...unique.values()];
}

function clampKtcScale(value: number): number {
  return Math.max(1, Math.min(10000, Math.round(value)));
}

function median(values: number[]): number | null {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function isTrustedConsensusSource(
  source: MarketSourceKey,
): source is TrustedMarketSourceKey {
  return (CONSENSUS_TRUSTED_SOURCES as readonly string[]).includes(source);
}

function fallbackKtcScaleFactor(source: MarketSourceKey): number {
  // Tradyr publishes a 0-1000 composite; DD/FantasyCalc/StatsGuy are already
  // approximately 0-10000. Actual league-overlap calibration replaces these
  // fallbacks whenever enough simultaneous KTC observations exist.
  if (source === "TRADYR") return 10;
  return 1;
}

async function persistDirectIdSource(
  snapshot: ProviderSnapshot,
  refreshRunId: string,
): Promise<number> {
  const leaguePlayers = await currentLeaguePlayers();
  const bySleeperId = new Map(leaguePlayers.map((p) => [p.sleeperId, p]));
  const byNamePos = new Map<string, typeof leaguePlayers>();
  for (const p of leaguePlayers) {
    const key = `${p.normalizedName}|${p.position}`;
    const list = byNamePos.get(key) ?? [];
    list.push(p);
    byNamePos.set(key, list);
  }

  const matched: Array<{
    row: ProviderRow;
    player: (typeof leaguePlayers)[number];
  }> = [];
  const seen = new Set<string>();
  for (const row of snapshot.rows) {
    let player = row.sleeperId ? bySleeperId.get(row.sleeperId) : undefined;
    if (!player) {
      const key = `${normalizePlayerName(row.name)}|${row.position ?? ""}`;
      const candidates = byNamePos.get(key) ?? [];
      if (candidates.length === 1) player = candidates[0];
    }
    if (!player || seen.has(player.id)) continue;
    seen.add(player.id);
    matched.push({ row, player });
  }

  const ktcObs = await marketDb.marketObservation.findMany({
    where: {
      refreshRunId,
      source: "KTC",
      playerId: { in: matched.map((m) => m.player.id) },
    },
  });
  const ktcByPlayer = new Map<string, number>(
    ktcObs.map((o) => [o.playerId, Number(o.rawValue)]),
  );
  const ratios = matched.flatMap(({ row, player }) => {
    const ktc = ktcByPlayer.get(player.id);
    return ktc && row.rawValue > 0 ? [ktc / row.rawValue] : [];
  });
  let scaleFactor =
    ratios.length >= 5
      ? (median(ratios) ?? fallbackKtcScaleFactor(snapshot.source))
      : fallbackKtcScaleFactor(snapshot.source);
  // Reject a broken calibration from a malformed provider payload.
  const lo = snapshot.source === "TRADYR" ? 3 : 0.3;
  const hi = snapshot.source === "TRADYR" ? 20 : 3;
  scaleFactor = Math.max(lo, Math.min(hi, scaleFactor));

  let stored = 0;
  for (const { row, player } of matched) {
    const normalized = clampKtcScale(row.rawValue * scaleFactor);
    const anchorKtcValue = ktcByPlayer.get(player.id) ?? null;
    const divergencePct =
      anchorKtcValue && anchorKtcValue > 0
        ? (normalized - anchorKtcValue) / anchorKtcValue
        : null;
    try {
      await marketDb.marketObservation.create({
        data: {
          playerId: player.id,
          source: snapshot.source,
          rawValue: row.rawValue,
          normalizedValue: normalized,
          observedAt: snapshot.fetchedAt,
          sourceUpdatedAt: snapshot.sourceUpdatedAt,
          sourceUrl: snapshot.sourceUrl,
          refreshRunId,
          sourceRank: row.rank,
          positionRank: row.positionRank,
          metadata: JSON.stringify({
            ...(row.metadata ?? {}),
            normalizedTo: "KTC",
            ktcScaleFactor: Number(scaleFactor.toFixed(6)),
            anchorKtcValue,
            divergencePct:
              divergencePct === null ? null : Number(divergencePct.toFixed(4)),
            trustedSecondary:
              isTrustedConsensusSource(snapshot.source) &&
              snapshot.source !== "KTC",
          }),
        },
      });
      stored++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("unique")) throw err;
    }
  }
  return stored;
}

async function persistKtc(
  snapshot: ProviderSnapshot,
  refreshRunId: string,
): Promise<number> {
  const leaguePlayers = await currentLeaguePlayers();
  const currentIds = new Set(leaguePlayers.map((p) => p.ktcId).filter(Boolean));
  const currentNamePos = new Set(
    leaguePlayers.map((p) => `${p.normalizedName}|${p.position}`),
  );
  const relevant = snapshot.rows.filter(
    (r) =>
      (r.ktcId && currentIds.has(r.ktcId)) ||
      currentNamePos.has(`${normalizePlayerName(r.name)}|${r.position ?? ""}`),
  );
  const importRows: KtcImportRow[] = relevant.map((r) => ({
    name: r.name,
    position: r.position,
    team: r.team,
    value: r.rawValue,
    ktcId: r.ktcId,
    rank: r.rank,
  }));
  const summary = await commitKtcImport(importRows, {
    sourceUrl: snapshot.sourceUrl,
    refreshRunId,
    sourceType: "AUTO_SCRAPE",
    observedAt: snapshot.fetchedAt,
  });
  const byPlayerOutcome = new Map(
    summary.results.filter((r) => r.playerId).map((r) => [r.playerId!, r]),
  );
  let stored = 0;
  for (const row of relevant) {
    const match = summary.results.find(
      (r) =>
        r.playerId &&
        ((row.ktcId && r.row.ktcId === row.ktcId) ||
          (normalizePlayerName(r.row.name) === normalizePlayerName(row.name) &&
            r.row.position === row.position)),
    );
    if (
      !match?.playerId ||
      match.outcome === "flagged" ||
      match.outcome === "rejected" ||
      match.outcome === "ambiguous" ||
      match.outcome === "unmatched"
    )
      continue;
    if (byPlayerOutcome.get(match.playerId)?.outcome === "flagged") continue;
    try {
      await marketDb.marketObservation.create({
        data: {
          playerId: match.playerId,
          source: "KTC",
          rawValue: row.rawValue,
          normalizedValue: clampKtcScale(row.rawValue),
          observedAt: snapshot.fetchedAt,
          sourceUpdatedAt: snapshot.sourceUpdatedAt,
          sourceUrl: snapshot.sourceUrl,
          refreshRunId,
          sourceRank: row.rank,
          positionRank: row.positionRank,
          metadata: JSON.stringify(row.metadata ?? {}),
        },
      });
      stored++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("unique")) throw err;
    }
  }
  return stored;
}

async function buildConsensus(
  refreshRunId: string,
  observedAt = new Date(),
): Promise<number> {
  const observations = await marketDb.marketObservation.findMany({
    where: { refreshRunId },
  });
  const byPlayer = new Map<string, typeof observations>();
  for (const obs of observations) {
    const list = byPlayer.get(obs.playerId) ?? [];
    list.push(obs);
    byPlayer.set(obs.playerId, list);
  }
  let stored = 0;
  for (const [playerId, list] of byPlayer) {
    const fresh = list.filter((o) => {
      const anchor = o.sourceUpdatedAt ?? o.observedAt;
      return (
        observedAt.getTime() - anchor.getTime() <= MARKET_SOURCE_MAX_AGE_MS
      );
    });
    const ktc = fresh.find((o) => o.source === "KTC");
    if (!ktc) continue; // Patch 14 never publishes a consensus without the KTC anchor.

    const trusted = fresh.filter((o) =>
      isTrustedConsensusSource(o.source as MarketSourceKey),
    );
    const eligible = trusted.filter((o) => {
      if (o.source === "KTC") return true;
      const absDiff = Math.abs(
        Number(o.normalizedValue) - Number(ktc.rawValue),
      );
      const relative =
        Number(ktc.rawValue) > 0 ? absDiff / Number(ktc.rawValue) : Infinity;
      // A low-value asset can move hundreds of KTC points without a meaningful
      // percentage interpretation, so allow a small absolute tolerance too.
      return relative <= SECONDARY_KTC_DIVERGENCE_LIMIT || absDiff <= 500;
    });
    if (eligible.length < 2) continue;

    const totalConfigured = eligible.reduce(
      (sum, o) => sum + CONSENSUS_WEIGHTS[o.source as TrustedMarketSourceKey],
      0,
    );
    if (totalConfigured <= 0) continue;
    const effectiveWeights: Record<string, number> = {};
    let weighted = 0;
    for (const obs of eligible) {
      const w =
        CONSENSUS_WEIGHTS[obs.source as TrustedMarketSourceKey] /
        totalConfigured;
      effectiveWeights[obs.source] = w;
      weighted += Number(obs.normalizedValue) * w;
    }
    await marketDb.consensusObservation.upsert({
      where: { playerId_refreshRunId: { playerId, refreshRunId } },
      update: {},
      create: {
        playerId,
        value: clampKtcScale(weighted),
        observedAt,
        refreshRunId,
        sourcesUsed: JSON.stringify(eligible.map((o) => o.source)),
        sourceCount: eligible.length,
        weights: JSON.stringify(effectiveWeights),
      },
    });
    stored++;
  }
  return stored;
}

function disabledStatus(source: MarketSourceKey): MarketSourceStatus {
  return {
    source,
    enabled: false,
    ok: false,
    eligibleForConsensus: false,
    fetchedAt: null,
    sourceUpdatedAt: null,
    sourceAgeMs: null,
    rowsReceived: 0,
    rowsStored: 0,
    message: "Disabled by configuration",
  };
}

async function runSource(
  source: MarketSourceKey,
  enabled: boolean,
  fetcher: () => Promise<ProviderSnapshot>,
  refreshRunId: string,
): Promise<MarketSourceStatus> {
  if (!enabled) return disabledStatus(source);
  try {
    const snapshot = await fetcher();
    assertFresh(source, snapshot.sourceUpdatedAt, snapshot.fetchedAt);
    const stored =
      source === "KTC"
        ? await persistKtc(snapshot, refreshRunId)
        : await persistDirectIdSource(snapshot, refreshRunId);
    const trusted = isTrustedConsensusSource(source);
    return {
      source,
      enabled: true,
      ok: true,
      eligibleForConsensus: trusted,
      fetchedAt: snapshot.fetchedAt.toISOString(),
      sourceUpdatedAt: snapshot.sourceUpdatedAt.toISOString(),
      sourceAgeMs: sourceAge(snapshot.sourceUpdatedAt, snapshot.fetchedAt),
      rowsReceived: snapshot.rows.length,
      rowsStored: stored,
      message: trusted
        ? snapshot.message
        : `${snapshot.message} · diagnostic only (not used in Patch 14 consensus)`,
    };
  } catch (err) {
    return {
      source,
      enabled: true,
      ok: false,
      eligibleForConsensus: false,
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: null,
      sourceAgeMs: null,
      rowsReceived: 0,
      rowsStored: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function refreshLiveMarketSources(
  refreshRunId: string,
): Promise<MarketRefreshResult> {
  // KTC runs first because every trusted secondary is calibrated onto the KTC
  // scale from same-refresh overlap. Other feeds then run independently.
  const ktc = await runSource(
    "KTC",
    KTC_DIRECT_REFRESH_ENABLED,
    fetchKtcSnapshot,
    refreshRunId,
  );
  const rest = await Promise.all([
    runSource(
      "TRADYR",
      TRADYR_REFRESH_ENABLED,
      fetchTradyrSnapshot,
      refreshRunId,
    ),
    runSource(
      "DYNASTY_DEALER",
      DYNASTY_DEALER_REFRESH_ENABLED,
      fetchDynastyDealerSnapshot,
      refreshRunId,
    ),
    runSource(
      "FANTASYCALC",
      FANTASYCALC_REFRESH_ENABLED,
      fetchFantasyCalcSnapshot,
      refreshRunId,
    ),
    runSource(
      "STATSGUY",
      STATSGUY_REFRESH_ENABLED,
      fetchStatsGuySnapshot,
      refreshRunId,
    ),
  ]);
  const statuses = [ktc, ...rest];
  const consensusPlayersStored = await buildConsensus(refreshRunId);
  return {
    statuses,
    consensusPlayersStored,
    marketObservationsStored: statuses.reduce(
      (sum, s) => sum + s.rowsStored,
      0,
    ),
  };
}

export interface CurrentMarketMix {
  playerId: string;
  consensusValue: number | null;
  consensusObservedAt: string | null;
  consensusSourceCount: number;
  consensusSources: string[];
  ktcValue: number | null;
  tradyrValue: number | null;
  dynastyDealerValue: number | null;
  fantasyCalcValue: number | null;
  statsGuyValue: number | null;
}

export async function getCurrentMarketMix(
  playerIds: string[],
): Promise<Map<string, CurrentMarketMix>> {
  const result = new Map<string, CurrentMarketMix>();
  for (const playerId of playerIds)
    result.set(playerId, {
      playerId,
      consensusValue: null,
      consensusObservedAt: null,
      consensusSourceCount: 0,
      consensusSources: [],
      ktcValue: null,
      tradyrValue: null,
      dynastyDealerValue: null,
      fantasyCalcValue: null,
      statsGuyValue: null,
    });
  if (playerIds.length === 0) return result;
  const [consensus, market] = await Promise.all([
    marketDb.consensusObservation.findMany({
      where: { playerId: { in: playerIds } },
      orderBy: { observedAt: "desc" },
    }),
    marketDb.marketObservation.findMany({
      where: { playerId: { in: playerIds } },
      orderBy: { observedAt: "desc" },
    }),
  ]);
  const seenConsensus = new Set<string>();
  for (const c of consensus) {
    if (seenConsensus.has(c.playerId)) continue;
    seenConsensus.add(c.playerId);
    const row = result.get(c.playerId)!;
    row.consensusValue = c.value;
    row.consensusObservedAt = c.observedAt.toISOString();
    row.consensusSourceCount = c.sourceCount;
    try {
      row.consensusSources = JSON.parse(c.sourcesUsed);
    } catch {
      row.consensusSources = [];
    }
  }
  const seenSource = new Set<string>();
  for (const m of market) {
    const key = `${m.playerId}:${m.source}`;
    if (seenSource.has(key)) continue;
    seenSource.add(key);
    const row = result.get(m.playerId);
    if (!row) continue;
    // UI comparisons use the calibrated KTC-scale number for non-KTC feeds.
    if (m.source === "KTC") row.ktcValue = m.rawValue;
    if (m.source === "TRADYR") row.tradyrValue = m.normalizedValue;
    if (m.source === "DYNASTY_DEALER")
      row.dynastyDealerValue = m.normalizedValue;
    if (m.source === "FANTASYCALC") row.fantasyCalcValue = m.normalizedValue;
    if (m.source === "STATSGUY") row.statsGuyValue = m.normalizedValue;
  }
  return result;
}

export interface LatestMarketSourceStatus {
  observedAt: string | null;
  sourceUpdatedAt: string | null;
  ageMs: number | null;
  stale: boolean;
  trusted: boolean;
}

export async function getLatestMarketSourceStatuses(): Promise<
  Record<MarketSourceKey, LatestMarketSourceStatus>
> {
  const out = {} as Record<MarketSourceKey, LatestMarketSourceStatus>;
  for (const source of [
    "KTC",
    "TRADYR",
    "DYNASTY_DEALER",
    "FANTASYCALC",
    "STATSGUY",
  ] as MarketSourceKey[]) {
    const obs = await marketDb.marketObservation.findFirst({
      where: { source },
      orderBy: { observedAt: "desc" },
    });
    const anchor = obs?.sourceUpdatedAt ?? obs?.observedAt ?? null;
    const ageMs = anchor ? Date.now() - anchor.getTime() : null;
    out[source] = {
      observedAt: obs?.observedAt.toISOString() ?? null,
      sourceUpdatedAt: obs?.sourceUpdatedAt?.toISOString() ?? null,
      ageMs,
      stale: ageMs === null || ageMs > MARKET_SOURCE_MAX_AGE_MS,
      trusted: isTrustedConsensusSource(source),
    };
  }
  return out;
}
