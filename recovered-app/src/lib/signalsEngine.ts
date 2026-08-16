import { prisma } from "@/lib/prisma";
import { computeMarketDataForPlayers, type PlayerMarketData } from "@/lib/metrics";
import { computeSignal, type RosterContext, type SignalResult } from "@/lib/signals";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import { getLatestSlotMap } from "@/lib/teamMetrics";
import { getFootballContexts, type PlayerFootballContext } from "@/lib/nflContext";
import { getCurrentMarketMix } from "@/lib/marketSources";
import { getStoredPerformanceMap, type StoredPerformanceContext } from "@/lib/playerStats";

const PLAYABLE_VALUE_THRESHOLD = 300;

export interface LiveSignalEntry {
  result: SignalResult;
  market: PlayerMarketData;
  football: PlayerFootballContext | null;
  performance: StoredPerformanceContext | null;
  statsGuyValue: number | null;
  statsGuyRawValue: number | null;
  ktcValue: number | null;
  dynastyDealerValue: number | null;
  dynastyDealerRawValue: number | null;
}

function clamp(n: number, min = 0, max = 100): number { return Math.max(min, Math.min(max, n)); }

/**
 * Game results matter, but dynasty decisions should not whip around after one
 * bad Sunday, a preseason cameo, or an injury-shortened game. This layer caps
 * game-form impact, rewards sustained regular-season evidence, and protects
 * young/high-draft-capital assets from being turned into automatic sell/cut
 * calls on a 1-3 game sample.
 */
function applyPerformanceContext(base: SignalResult, performance: StoredPerformanceContext | null, football: PlayerFootballContext | null): SignalResult {
  if (!performance || performance.recentGames.length === 0) return base;
  const games = performance.recentGames.slice(0, 5);
  const weighted = games.map((g, index) => ({
    game: g,
    weight: (g.seasonType === "PRE" ? 0.35 : 1) * (index === 0 ? 1 : index === 1 ? 0.8 : index === 2 ? 0.65 : 0.45),
  }));
  const denom = weighted.reduce((s, x) => s + x.weight, 0);
  const form = denom > 0 ? weighted.reduce((s, x) => s + Number(x.game.gradeScore) * x.weight, 0) / denom : 70;
  const regularGames = games.filter((g) => g.seasonType === "REG" || g.seasonType === "POST");
  const badRegular = regularGames.filter((g) => Number(g.gradeScore) < 56).length;
  const goodRegular = regularGames.filter((g) => Number(g.gradeScore) >= 84).length;
  const sampleFactor = Math.min(1, denom / 3);
  const healthDelta = Math.round(clamp(((form - 70) / 6) * sampleFactor, -6, 6));

  const profile = performance.profile;
  const highDraftCapital = profile?.draftRound !== null && profile?.draftRound !== undefined && profile.draftRound <= 2;
  const earlyCareer = (football?.yearsExp ?? 99) <= 3;
  const protectedDevelopmentAsset = highDraftCapital && earlyCareer;

  const analytics = { ...base.analytics };
  if (healthDelta > 0) {
    analytics.holdSupportScore = Math.round(clamp(analytics.holdSupportScore + healthDelta));
    analytics.downsideRiskScore = Math.round(clamp(analytics.downsideRiskScore - Math.ceil(healthDelta / 2)));
  } else if (healthDelta < 0) {
    const magnitude = Math.abs(healthDelta);
    analytics.holdSupportScore = Math.round(clamp(analytics.holdSupportScore - magnitude));
    analytics.downsideRiskScore = Math.round(clamp(analytics.downsideRiskScore + magnitude));
  }

  let signal = base.signal;
  // A small bad sample can never create an exit call by itself. If a young
  // round-1/2 player has only 1-3 poor regular-season games, downgrade an exit
  // label to WATCH unless the pre-existing market/role downside case is extreme.
  if (protectedDevelopmentAsset && badRegular > 0 && regularGames.length <= 3 && ["CUT_BAIT", "CUT_LOSSES", "SELL_HIGH"].includes(signal) && base.analytics.downsideRiskScore < 85 && base.analytics.sellHighScore < 88) {
    signal = "WATCH";
  }
  // Sustained poor play can add caution, but still does not manufacture a SELL.
  if (regularGames.length >= 4 && badRegular >= 4 && signal === "HOLD" && analytics.downsideRiskScore >= 55) signal = "WATCH";
  // Sustained good play can resolve a noisy WATCH back to HOLD when the market
  // itself is not flashing a strong sell/downside condition.
  if (regularGames.length >= 3 && goodRegular >= 3 && signal === "WATCH" && base.analytics.sellHighScore < 72 && analytics.downsideRiskScore < 65) signal = "HOLD";

  const reasons = [...base.reasonCodes];
  reasons.push({
    code: "RECENT_GAME_FORM",
    label: "Recent game performance",
    detail: `${games.length} most recent played game${games.length === 1 ? "" : "s"}: weighted grade ${form.toFixed(1)}/100. Game form is capped at ±6 asset-health points; preseason games count at 35% weight.`,
    impact: form >= 78 ? "POSITIVE" : form < 60 ? "NEGATIVE" : "NEUTRAL",
  });
  if (profile?.draftRound) {
    reasons.push({
      code: "DRAFT_CAPITAL_CONTEXT",
      label: "Draft-capital context",
      detail: `${profile.draftYear ?? "NFL"} Round ${profile.draftRound}${profile.draftPick ? `, pick ${profile.draftPick}` : ""}. ${protectedDevelopmentAsset ? "Early-career premium draft capital raises the evidence bar before a short bad-game sample can become an exit recommendation." : "Draft pedigree is treated as context, not a permanent shield from sustained role/market deterioration."}`,
      impact: protectedDevelopmentAsset ? "POSITIVE" : "NEUTRAL",
    });
  }

  const whatWouldChange = [...base.whatWouldChange];
  if (regularGames.length < 4) whatWouldChange.push("A 4+ game regular-season pattern carries much more signal weight than one to three isolated or injury-affected games.");
  if (badRegular > 0) whatWouldChange.push("Continued poor grades plus declining snap/usage and market value would make the negative performance evidence materially stronger.");
  if (goodRegular > 0) whatWouldChange.push("If strong grades continue without market repricing, HOLD/BUY support strengthens; if price outruns role growth, SELL HIGH can still become valid.");

  const summary = signal === base.signal
    ? `${base.summary} Recent game performance is included as bounded context rather than a one-game trigger.`
    : signal === "WATCH"
      ? "The underlying market/role model raised an exit concern, but the current game sample and development/draft-capital context are too small to justify forcing a sale. Watch for a sustained 4+ game pattern plus corroborating usage and market movement."
      : "Recent sustained performance resolves some of the model noise, but market value, role, age, roster construction, and longer-term trend remain the primary dynasty inputs.";

  return {
    ...base,
    signal,
    score: Math.round(clamp(base.score + healthDelta)),
    summary,
    reasonCodes: reasons,
    whatWouldChange,
    analytics,
  };
}

/** Computes a live signal for every currently-rostered player. */
export async function computeSignalsForCurrentRoster(): Promise<Map<string, LiveSignalEntry>> {
  const [entries, slotMap] = await Promise.all([getAllCurrentRosterEntries(), getLatestSlotMap()]);
  const playerIds = entries.map((e) => e.playerId);
  const sleeperIds = entries.map((e) => e.player.sleeperId);
  const [marketData, marketMix, footballContexts, performanceMap] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    getCurrentMarketMix(playerIds),
    getFootballContexts(sleeperIds),
    getStoredPerformanceMap(playerIds),
  ]);

  const depthByManagerPosition = new Map<string, number>();
  for (const e of entries) {
    const value = marketData.get(e.playerId)?.currentValue ?? 0;
    if (value < PLAYABLE_VALUE_THRESHOLD) continue;
    const key = `${e.managerId}:${e.player.position}`;
    depthByManagerPosition.set(key, (depthByManagerPosition.get(key) ?? 0) + 1);
  }

  const out = new Map<string, LiveSignalEntry>();
  for (const e of entries) {
    const market = marketData.get(e.playerId)!;
    const mix = marketMix.get(e.playerId)!;
    const football = footballContexts.get(e.player.sleeperId) ?? null;
    const performance = performanceMap.get(e.playerId) ?? null;
    const slot = (slotMap.get(`${e.managerId}:${e.playerId}`) ?? "BENCH") as RosterContext["slot"];
    const ctx: RosterContext = {
      slot,
      position: e.player.position,
      status: e.player.status,
      teamPositionCount: depthByManagerPosition.get(`${e.managerId}:${e.player.position}`) ?? 0,
      currentKtc: mix.ktcValue,
      statsGuyValue: null, // Stats Guy is diagnostic-only and cannot steer recommendations.
      football,
    };
    const result = applyPerformanceContext(computeSignal(market, ctx), performance, football);
    out.set(e.playerId, { result, market, football, performance, ktcValue: mix.ktcValue, statsGuyValue: mix.statsGuyValue, statsGuyRawValue: mix.statsGuyRawValue, dynastyDealerValue: mix.dynastyDealerValue, dynastyDealerRawValue: mix.dynastyDealerRawValue });
  }
  return out;
}

/** Persists a point-in-time signal snapshot for audit/history. */
export async function persistSignalsForRun(refreshRunId: string): Promise<void> {
  const signals = await computeSignalsForCurrentRoster();
  const rows = Array.from(signals.entries()).map(([playerId, { result }]) => ({
    playerId,
    refreshRunId,
    signal: result.signal,
    score: result.score,
    confidence: result.confidence,
    reasonCodes: JSON.stringify({ summary: result.summary, reasons: result.reasonCodes, whatWouldChange: result.whatWouldChange, analytics: result.analytics }),
  }));
  if (rows.length > 0) await prisma.signal.createMany({ data: rows });
}
