import type { PlayerMarketData } from "@/lib/metrics";
import type { PlayerFootballContext } from "@/lib/nflContext";

export type SignalType = "SELL_HIGH" | "HOLD" | "BUY_LOW" | "CUT_LOSSES" | "CUT_BAIT" | "WATCH";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";

export interface ReasonCode {
  code: string;
  label: string;
  detail: string;
  impact?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
}

export interface SignalAnalytics {
  trendSlopePctPer7d: number | null;
  trendFitR2: number | null;
  volatilityPct: number | null;
  rangePositionPct: number | null;
  maxDrawdownPct: number | null;
  historySpanDays: number;
  observationCount: number;
  sourceGapPct: number | null;
  sellHighScore: number;
  buyLowScore: number;
  downsideRiskScore: number;
  holdSupportScore: number;
}

export interface SignalResult {
  signal: SignalType;
  score: number; // 0-100 asset-health score, not a sell score
  confidence: Confidence;
  summary: string;
  reasonCodes: ReasonCode[];
  whatWouldChange: string[];
  analytics: SignalAnalytics;
}

export interface RosterContext {
  slot: "STARTER" | "BENCH" | "TAXI" | "IR";
  position: string;
  status: string | null;
  teamPositionCount: number;
  currentKtc: number | null;
  statsGuyValue: number | null;
  football: PlayerFootballContext | null;
}

const DEPTH_THRESHOLDS: Record<string, { need: number; surplus: number }> = {
  QB: { need: 2, surplus: 4 },
  RB: { need: 4, surplus: 7 },
  WR: { need: 4, surplus: 7 },
  TE: { need: 2, surplus: 4 },
};
const INJURY_FLAGS = new Set(["Out", "IR", "PUP", "Suspended", "NA"]);

function clamp(n: number, min = 0, max = 100): number { return Math.max(min, Math.min(max, n)); }
function round1(n: number): number { return Math.round(n * 10) / 10; }
function rosterNeedState(ctx: RosterContext): "SURPLUS" | "NEUTRAL" | "NEED" {
  const t = DEPTH_THRESHOLDS[ctx.position];
  if (!t) return "NEUTRAL";
  if (ctx.teamPositionCount >= t.surplus) return "SURPLUS";
  if (ctx.teamPositionCount <= t.need) return "NEED";
  return "NEUTRAL";
}

function dailySeries(market: PlayerMarketData): { t: number; value: number }[] {
  const byDay = new Map<string, { t: number; value: number }>();
  for (const p of market.sparkline) {
    const d = new Date(p.observedAt);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, { t: d.getTime(), value: p.value });
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t);
}

function regressionStats(market: PlayerMarketData): { slopePctPer7d: number | null; r2: number | null; volatilityPct: number | null; maxDrawdownPct: number | null; spanDays: number } {
  const s = dailySeries(market).filter((p) => p.value > 0);
  if (s.length < 2) return { slopePctPer7d: null, r2: null, volatilityPct: null, maxDrawdownPct: null, spanDays: 0 };
  const t0 = s[0].t;
  const xs = s.map((p) => (p.t - t0) / 86400000);
  const ys = s.map((p) => Math.log(p.value));
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const denom = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const beta = denom > 0 ? xs.reduce((sum, x, i) => sum + (x - xMean) * (ys[i] - yMean), 0) / denom : 0;
  const alpha = yMean - beta * xMean;
  const ssTot = ys.reduce((sum, y) => sum + (y - yMean) ** 2, 0);
  const ssRes = ys.reduce((sum, y, i) => sum + (y - (alpha + beta * xs[i])) ** 2, 0);
  const r2 = ssTot > 0 ? clamp(1 - ssRes / ssTot, 0, 1) : 1;
  const returns: number[] = [];
  let peak = s[0].value;
  let maxDrawdown = 0;
  for (let i = 0; i < s.length; i++) {
    peak = Math.max(peak, s[i].value);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, ((s[i].value - peak) / peak) * 100);
    if (i > 0 && s[i - 1].value > 0) returns.push(((s[i].value - s[i - 1].value) / s[i - 1].value) * 100);
  }
  const meanR = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length ? returns.reduce((sum, r) => sum + (r - meanR) ** 2, 0) / returns.length : 0;
  return {
    slopePctPer7d: round1((Math.exp(beta * 7) - 1) * 100),
    r2: round1(r2 * 100) / 100,
    volatilityPct: round1(Math.sqrt(variance)),
    maxDrawdownPct: round1(maxDrawdown),
    spanDays: round1((s[s.length - 1].t - s[0].t) / 86400000),
  };
}

function ageRiskThreshold(position: string): number {
  if (position === "RB") return 28;
  if (position === "WR") return 30;
  if (position === "TE") return 31;
  if (position === "QB") return 34;
  return 31;
}

function fmtPct(n: number | null): string { return n === null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; }

/**
 * Dynamic dynasty recommendation model. It uses market history, trend shape,
 * volatility, range position, roster utility, verified secondary-market data,
 * Sleeper depth/status, and nflverse in-season production/usage when available.
 * Nothing here is keyed to a player name; labels change as the inputs change.
 */
export function computeSignal(market: PlayerMarketData, ctx: RosterContext): SignalResult {
  const reasons: ReasonCode[] = [];
  const whatWouldChange: string[] = [];
  const current = market.currentValue ?? 0;
  const pct7 = market.change7d?.percent ?? null;
  const pct30 = market.change30d?.percent ?? null;
  const distHigh = market.distanceFromHigh?.percent ?? null;
  const distLow = market.distanceFromLow?.percent ?? null;
  const rangePosition = market.high && market.low && market.high.value !== market.low.value && market.currentValue !== null
    ? ((market.currentValue - market.low.value) / (market.high.value - market.low.value)) * 100
    : null;
  const regression = regressionStats(market);
  const needState = rosterNeedState(ctx);
  const football = ctx.football;
  const flagged = !!ctx.status && INJURY_FLAGS.has(ctx.status);
  const age = football?.age ?? null;
  const yearsExp = football?.yearsExp ?? null;
  const depth = football?.depthChartOrder ?? null;
  const isYoung = yearsExp !== null ? yearsExp <= 2 : age !== null ? age <= 24 : false;
  const aging = age !== null && age >= ageRiskThreshold(ctx.position);
  const sourceGapPct = ctx.currentKtc && ctx.statsGuyValue !== null && ctx.currentKtc > 0
    ? ((ctx.statsGuyValue - ctx.currentKtc) / ctx.currentKtc) * 100
    : null;

  if (pct7 !== null) reasons.push({ code: "TREND_7D", label: "7-day market move", detail: `${fmtPct(pct7)} from ${market.change7d?.fromValue.toLocaleString()} to ${current.toLocaleString()}`, impact: pct7 >= 0 ? "POSITIVE" : "NEGATIVE" });
  if (pct30 !== null) reasons.push({ code: "TREND_30D", label: "30-day market move", detail: `${fmtPct(pct30)} from ${market.change30d?.fromValue.toLocaleString()} to ${current.toLocaleString()}`, impact: pct30 >= 0 ? "POSITIVE" : "NEGATIVE" });
  if (regression.slopePctPer7d !== null) reasons.push({ code: "REGRESSION_SLOPE", label: "Trend-line slope", detail: `${fmtPct(regression.slopePctPer7d)} per 7 days across ${regression.spanDays.toFixed(0)} tracked days (fit R² ${regression.r2?.toFixed(2) ?? "n/a"})`, impact: regression.slopePctPer7d >= 0 ? "POSITIVE" : "NEGATIVE" });
  if (rangePosition !== null) reasons.push({ code: "RANGE_POSITION", label: "Tracked-range position", detail: `${rangePosition.toFixed(0)}th percentile of saved history; ${distHigh?.toFixed(1) ?? "n/a"}% from tracked high`, impact: rangePosition >= 80 ? "POSITIVE" : rangePosition <= 25 ? "NEGATIVE" : "NEUTRAL" });
  if (regression.volatilityPct !== null) reasons.push({ code: "VOLATILITY", label: "Observed volatility", detail: `${regression.volatilityPct.toFixed(1)}% standard deviation of day-to-day value changes`, impact: regression.volatilityPct >= 8 ? "NEGATIVE" : "NEUTRAL" });

  reasons.push({ code: `ROSTER_${needState}`, label: `${needState === "SURPLUS" ? "Positional surplus" : needState === "NEED" ? "Positional need" : "Adequate positional depth"}`, detail: `Owning roster has ${ctx.teamPositionCount} value-relevant ${ctx.position}s; player is currently ${ctx.slot.toLowerCase()}`, impact: needState === "NEED" || ctx.slot === "STARTER" ? "POSITIVE" : needState === "SURPLUS" ? "NEGATIVE" : "NEUTRAL" });

  if (depth !== null) reasons.push({ code: "DEPTH_CHART", label: "NFL depth-chart context", detail: `${football?.depthChartPosition ?? ctx.position} depth-chart order ${depth}`, impact: depth <= 1 ? "POSITIVE" : depth >= 3 ? "NEGATIVE" : "NEUTRAL" });
  if (flagged || football?.active === false) reasons.push({ code: "STATUS_RISK", label: "Availability flag", detail: `Current Sleeper/NFL status: ${ctx.status ?? "inactive"}${football?.practiceDescription ? ` · ${football.practiceDescription}` : ""}`, impact: "NEGATIVE" });
  if (isYoung) reasons.push({ code: "YOUNG_ASSET", label: "Development curve", detail: `${yearsExp ?? "≤2"} years of NFL experience; rising value can represent genuine breakout repricing rather than an automatic sell-high`, impact: "POSITIVE" });
  if (aging) reasons.push({ code: "AGE_CURVE", label: "Age-curve pressure", detail: `Age ${age}; dynasty downside risk rises faster at this position when market value is near a peak`, impact: "NEGATIVE" });

  const perf = football?.currentSeason;
  if (perf && perf.games >= 1) {
    reasons.push({ code: "SEASON_PRODUCTION", label: `${perf.season} production`, detail: `${perf.halfPprPpg.toFixed(1)} half-PPR points/game over ${perf.games} games; ${perf.opportunitiesPerGame.toFixed(1)} opportunities/game`, impact: perf.halfPprPpg >= 12 ? "POSITIVE" : "NEUTRAL" });
    if (perf.usageTrendPercent !== null) reasons.push({ code: "USAGE_TREND", label: "Recent usage trend", detail: `Last-3 opportunity rate is ${fmtPct(perf.usageTrendPercent)} versus season average`, impact: perf.usageTrendPercent >= 10 ? "POSITIVE" : perf.usageTrendPercent <= -15 ? "NEGATIVE" : "NEUTRAL" });
    if (perf.fantasyTrendPercent !== null) reasons.push({ code: "FANTASY_TREND", label: "Recent fantasy production", detail: `Last-3 half-PPR scoring rate is ${fmtPct(perf.fantasyTrendPercent)} versus season average`, impact: perf.fantasyTrendPercent >= 15 ? "POSITIVE" : perf.fantasyTrendPercent <= -20 ? "NEGATIVE" : "NEUTRAL" });
  } else if (football?.priorSeason) {
    reasons.push({ code: "PRIOR_SEASON_ROLE", label: `${football.priorSeason.season} role baseline`, detail: `${football.priorSeason.halfPprPpg.toFixed(1)} half-PPR points/game and ${football.priorSeason.opportunitiesPerGame.toFixed(1)} opportunities/game; current-season sample not available yet`, impact: "NEUTRAL" });
  }

  if (sourceGapPct !== null && Math.abs(sourceGapPct) >= 15) reasons.push({ code: "SOURCE_DISAGREEMENT", label: "Market-source disagreement", detail: `Stats Guy’s KTC-equivalent value is ${fmtPct(sourceGapPct)} versus KTC; this reduces model confidence rather than forcing a trade signal`, impact: "NEUTRAL" });

  // Component scores. Each recommendation has its own evidence score rather
  // than deriving all labels from one rising/falling-price number.
  let holdSupport = 35;
  if (ctx.slot === "STARTER") holdSupport += 18;
  if (needState === "NEED") holdSupport += 12;
  if (isYoung) holdSupport += 10;
  if ((pct30 ?? 0) > 5) holdSupport += 8;
  if ((regression.slopePctPer7d ?? 0) > 1) holdSupport += 7;
  if ((perf?.usageTrendPercent ?? 0) > 10) holdSupport += 10;
  if ((perf?.fantasyTrendPercent ?? 0) > 15) holdSupport += 8;
  if (flagged) holdSupport -= 12;
  if (depth !== null && depth >= 3) holdSupport -= 10;
  holdSupport = clamp(holdSupport);

  let sellHigh = 0;
  if ((rangePosition ?? 50) >= 88) sellHigh += 25;
  if ((pct30 ?? 0) >= 15) sellHigh += 20;
  if ((pct7 ?? 0) >= 8) sellHigh += 12;
  if ((pct30 ?? 0) > 12 && (pct7 ?? 0) < 2) sellHigh += 18; // spike starting to cool
  if (needState === "SURPLUS") sellHigh += 12;
  if (ctx.slot === "BENCH" || ctx.slot === "TAXI") sellHigh += 10;
  if (aging) sellHigh += 12;
  if (isYoung) sellHigh -= 15;
  if ((perf?.usageTrendPercent ?? 0) > 10) sellHigh -= 15;
  if ((perf?.fantasyTrendPercent ?? 0) > 15) sellHigh -= 8;
  sellHigh = clamp(sellHigh);

  let buyLow = 0;
  if ((distHigh ?? 0) <= -20) buyLow += 25;
  if ((rangePosition ?? 50) <= 30) buyLow += 18;
  if ((pct30 ?? 0) < -10 && (pct7 ?? -99) >= -2) buyLow += 22; // falling asset that has stabilized
  if ((regression.slopePctPer7d ?? 0) > 0) buyLow += 12;
  if (ctx.slot === "STARTER" || needState === "NEED") buyLow += 10;
  if ((perf?.usageTrendPercent ?? 0) > 5) buyLow += 12;
  if (flagged || (depth !== null && depth >= 3)) buyLow -= 20;
  buyLow = clamp(buyLow);

  let downsideRisk = 0;
  if ((pct30 ?? 0) <= -15) downsideRisk += 22;
  if ((pct7 ?? 0) <= -8) downsideRisk += 12;
  if ((regression.slopePctPer7d ?? 0) <= -3) downsideRisk += 18;
  if ((rangePosition ?? 50) <= 20) downsideRisk += 12;
  if (ctx.slot === "BENCH" || ctx.slot === "TAXI") downsideRisk += 8;
  if (flagged || football?.active === false) downsideRisk += 18;
  if (depth !== null && depth >= 3) downsideRisk += 15;
  if ((perf?.usageTrendPercent ?? 0) <= -20) downsideRisk += 15;
  if (isYoung) downsideRisk -= 8;
  downsideRisk = clamp(downsideRisk);

  let assetHealth = 50;
  assetHealth += clamp((pct30 ?? 0) * 0.6, -15, 15);
  assetHealth += clamp((regression.slopePctPer7d ?? 0) * 1.5, -12, 12);
  assetHealth += ctx.slot === "STARTER" ? 8 : 0;
  assetHealth += depth !== null && depth <= 1 ? 7 : depth !== null && depth >= 3 ? -8 : 0;
  assetHealth += (perf?.usageTrendPercent ?? 0) > 10 ? 8 : (perf?.usageTrendPercent ?? 0) < -20 ? -8 : 0;
  assetHealth += flagged ? -12 : 0;
  assetHealth = Math.round(clamp(assetHealth));

  const conflicting = pct7 !== null && pct30 !== null && Math.sign(pct7) !== 0 && Math.sign(pct30) !== 0 && Math.sign(pct7) !== Math.sign(pct30);
  const highVol = (regression.volatilityPct ?? 0) >= 10;

  let signal: SignalType = "HOLD";
  if (market.observationCount < 3 || market.dataAgeMs === null) {
    signal = "WATCH";
  } else if (current < 700 && downsideRisk >= 65 && ctx.slot !== "STARTER") {
    signal = "CUT_BAIT";
  } else if (downsideRisk >= 72 && current >= 700 && ctx.slot !== "STARTER") {
    signal = "CUT_LOSSES";
  } else if (sellHigh >= (isYoung || ctx.slot === "STARTER" ? 82 : 72) && sellHigh > holdSupport + 8) {
    signal = "SELL_HIGH";
  } else if (buyLow >= 72 && downsideRisk < 70) {
    signal = "BUY_LOW";
  } else if (conflicting || highVol || Math.abs(sourceGapPct ?? 0) >= 30) {
    signal = "WATCH";
  } else {
    signal = "HOLD";
  }
  if (ctx.currentKtc === null) signal = "WATCH";

  let confidence: Confidence = "MEDIUM";
  if (market.observationCount < 4 || market.isStale || regression.spanDays < 5) confidence = "LOW";
  else if (market.observationCount >= 8 && regression.spanDays >= 14 && !highVol && Math.abs(sourceGapPct ?? 0) < 25) confidence = "HIGH";
  if (ctx.currentKtc === null) confidence = "LOW";

  const summaryMap: Record<SignalType, string> = {
    HOLD: "The evidence is not strong enough to force a move. Hold unless the trade market gives you a clear overpay, the player role changes, or your roster build makes the asset expendable.",
    WATCH: "The inputs are mixed or statistically noisy. The model would rather collect another meaningful market/role data point than force a directional trade call.",
    SELL_HIGH: "The player is priced near the top of the tracked range after a meaningful run-up, while roster/age/usage context provides enough reason to test the market rather than automatically chase the rise.",
    BUY_LOW: "The player is materially below the tracked peak but shows stabilization or role support, creating a buy-the-dip profile rather than a simple falling-knife signal.",
    CUT_LOSSES: "The decline is persistent and supported by weak role/roster evidence. The player still has enough market value that moving now may be preferable to waiting for a full collapse.",
    CUT_BAIT: "The asset is low-value, near the bottom of its tracked range, and lacks enough role or trend support to justify occupying a roster spot unless league depth makes the stash valuable.",
  };

  if (signal === "SELL_HIGH") whatWouldChange.push("Sustained or rising NFL usage/production would strengthen the HOLD case and weaken the sell-high case.", "A pullback away from the tracked high without role deterioration would remove the overextension signal.");
  if (signal === "BUY_LOW") whatWouldChange.push("Another leg down in both market value and NFL usage would turn this from BUY LOW into WATCH/CUT LOSSES.", "A clear positive 7-day trend plus stable depth-chart role would raise confidence.");
  if (signal === "CUT_LOSSES" || signal === "CUT_BAIT") whatWouldChange.push("A depth-chart promotion, restored health, or a sustained usage increase would materially reduce downside risk.", "A reversal in the 7-day slope after the 30-day decline would move the label toward WATCH.");
  if (signal === "WATCH") whatWouldChange.push("Two or more additional non-flat market observations will improve trend confidence.", "A consistent 7-day/30-day direction plus stable NFL role will move the label toward HOLD, BUY LOW, or SELL HIGH.");
  if (signal === "HOLD") whatWouldChange.push("A sharp value spike without matching usage growth could create a SELL HIGH setup.", "A sustained value decline plus depth-chart/usage deterioration could shift the label toward WATCH or CUT LOSSES.");

  if (ctx.currentKtc === null) {
    reasons.push({ code: "NO_FRESH_KTC_ANCHOR", label: "Current KTC anchor unavailable", detail: "The saved KTC history is retained for context, but there is no freshness-qualified KTC observation in the current market ingest. Secondary values are not allowed to create an action call by themselves.", impact: "NEGATIVE" });
    whatWouldChange.unshift("A fresh KTC observation is required before the model will issue a directional BUY LOW, SELL HIGH, CUT LOSSES, or CUT BAIT call.");
  }
  if (market.isStale) reasons.push({ code: "STALE_DATA", label: "Freshness warning", detail: "No confirmed KTC value in the last 48 hours; confidence is reduced", impact: "NEGATIVE" });
  if (market.observationCount < 4) reasons.push({ code: "LOW_SAMPLE", label: "Limited history", detail: `Only ${market.observationCount} valid KTC observations are stored`, impact: "NEUTRAL" });

  return {
    signal,
    score: assetHealth,
    confidence,
    summary: summaryMap[signal],
    reasonCodes: reasons,
    whatWouldChange,
    analytics: {
      trendSlopePctPer7d: regression.slopePctPer7d,
      trendFitR2: regression.r2,
      volatilityPct: regression.volatilityPct,
      rangePositionPct: rangePosition === null ? null : round1(rangePosition),
      maxDrawdownPct: regression.maxDrawdownPct,
      historySpanDays: regression.spanDays,
      observationCount: market.observationCount,
      sourceGapPct: sourceGapPct === null ? null : round1(sourceGapPct),
      sellHighScore: Math.round(sellHigh),
      buyLowScore: Math.round(buyLow),
      downsideRiskScore: Math.round(downsideRisk),
      holdSupportScore: Math.round(holdSupport),
    },
  };
}
