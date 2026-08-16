import type { PlayerMarketData } from "@/lib/metrics";

export type SignalType = "SELL_HIGH" | "HOLD" | "BUY_LOW" | "CUT_BAIT" | "WATCH";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";

export interface ReasonCode {
  code: string;
  label: string;
  detail: string;
}

export interface SignalResult {
  signal: SignalType;
  score: number; // 0-100 transparent market score (higher = stronger appreciation/sell-side case)
  confidence: Confidence;
  reasonCodes: ReasonCode[];
}

export interface RosterContext {
  slot: "STARTER" | "BENCH" | "TAXI" | "IR";
  position: string;
  status: string | null; // Sleeper injury_status/status
  // Count of roster-relevant (currentValue >= 300) players the owning team
  // holds at this position, used to judge surplus vs need.
  teamPositionCount: number;
}

// Dynasty Superflex depth heuristics: below `need` = need, at/above `surplus` = surplus.
const DEPTH_THRESHOLDS: Record<string, { need: number; surplus: number }> = {
  QB: { need: 2, surplus: 4 },
  RB: { need: 4, surplus: 7 },
  WR: { need: 4, surplus: 7 },
  TE: { need: 2, surplus: 4 },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function rosterNeedState(ctx: RosterContext): "SURPLUS" | "NEUTRAL" | "NEED" {
  const t = DEPTH_THRESHOLDS[ctx.position];
  if (!t) return "NEUTRAL";
  if (ctx.teamPositionCount >= t.surplus) return "SURPLUS";
  if (ctx.teamPositionCount <= t.need) return "NEED";
  return "NEUTRAL";
}

const INJURY_FLAGS = new Set(["Out", "IR", "PUP", "Suspended", "NA"]);

/**
 * Transparent, additive 0-100 market score plus a stock-market-style signal
 * that combines price movement with roster context — appreciation alone
 * doesn't mean sell, and a falling price alone doesn't mean buy.
 */
export function computeSignal(market: PlayerMarketData, ctx: RosterContext): SignalResult {
  const reasonCodes: ReasonCode[] = [];

  // --- Momentum component (35%) ---------------------------------------
  const pct7d = market.change7d?.percent ?? 0;
  const pct30d = market.change30d?.percent ?? 0;
  const avgMomentumPct = market.change7d && market.change30d ? 0.6 * pct7d + 0.4 * pct30d : pct7d || pct30d;
  const momentumScore = clamp(50 + avgMomentumPct * 2, 0, 100);
  if (market.change7d) {
    reasonCodes.push({
      code: pct7d >= 0 ? "MOMENTUM_UP_7D" : "MOMENTUM_DOWN_7D",
      label: `7-day momentum ${pct7d >= 0 ? "up" : "down"}`,
      detail: `${pct7d >= 0 ? "+" : ""}${pct7d.toFixed(1)}% over 7 days`,
    });
  }
  if (market.change30d) {
    reasonCodes.push({
      code: pct30d >= 0 ? "MOMENTUM_UP_30D" : "MOMENTUM_DOWN_30D",
      label: `30-day momentum ${pct30d >= 0 ? "up" : "down"}`,
      detail: `${pct30d >= 0 ? "+" : ""}${pct30d.toFixed(1)}% over 30 days`,
    });
  }

  // --- Peak proximity component (25%) ----------------------------------
  const distFromHighPct = market.distanceFromHigh?.percent ?? -50; // unknown -> assume mid-range
  const proximityScore = clamp(100 + distFromHighPct * 1.5, 0, 100);
  const nearHigh = distFromHighPct >= -10;
  const bigDrawdown = distFromHighPct <= -30;
  if (market.high) {
    reasonCodes.push({
      code: nearHigh ? "NEAR_TRACKED_HIGH" : bigDrawdown ? "LARGE_DRAWDOWN" : "MID_RANGE",
      label: nearHigh ? "Near tracked high" : bigDrawdown ? "Large drawdown from peak" : "Mid-range from peak",
      detail: `${distFromHighPct.toFixed(1)}% from tracked high of ${market.high.value}`,
    });
  }

  // --- Roster context component (25%) -----------------------------------
  const needState = rosterNeedState(ctx);
  let rosterScore = 50;
  if (needState === "SURPLUS") rosterScore += 20;
  if (needState === "NEED") rosterScore -= 20;
  if (ctx.slot === "BENCH" || ctx.slot === "TAXI") rosterScore += 8; // unplayed value slightly favors selling
  if (ctx.slot === "STARTER") rosterScore -= 8; // active lineup piece slightly favors holding
  if (ctx.slot === "IR") rosterScore -= 15;
  rosterScore = clamp(rosterScore, 0, 100);

  reasonCodes.push({
    code: `ROSTER_${needState}_${ctx.position}`,
    label: `${needState === "SURPLUS" ? "Surplus" : needState === "NEED" ? "Need" : "Adequate depth"} at ${ctx.position}`,
    detail: `Team rosters ${ctx.teamPositionCount} roster-relevant ${ctx.position}s`,
  });
  reasonCodes.push({
    code: `SLOT_${ctx.slot}`,
    label: `Currently ${ctx.slot.toLowerCase()}`,
    detail: `Latest sync had this player in the ${ctx.slot.toLowerCase()} slot`,
  });

  // --- Status/injury component (15%) ------------------------------------
  let statusScore = 60;
  const flagged = ctx.status ? INJURY_FLAGS.has(ctx.status) : false;
  if (flagged) {
    statusScore = 15;
    reasonCodes.push({
      code: "STATUS_FLAG",
      label: "Injury/roster status flag",
      detail: `Sleeper reports status: ${ctx.status}`,
    });
  }

  // --- Volatility (informs confidence, not score) ------------------------
  const recent = market.sparkline.slice(-8);
  let volatility = 0;
  if (recent.length >= 3) {
    const pctChanges: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1].value;
      if (prev !== 0) pctChanges.push((recent[i].value - prev) / prev);
    }
    const mean = pctChanges.reduce((s, x) => s + x, 0) / (pctChanges.length || 1);
    const variance = pctChanges.reduce((s, x) => s + (x - mean) ** 2, 0) / (pctChanges.length || 1);
    volatility = Math.sqrt(variance);
  }

  const score = Math.round(
    momentumScore * 0.35 + proximityScore * 0.25 + rosterScore * 0.25 + statusScore * 0.15,
  );

  // --- Confidence ---------------------------------------------------------
  let confidence: Confidence = "MEDIUM";
  if (market.observationCount < 3 || market.dataAgeMs === null) {
    confidence = "LOW";
    reasonCodes.push({
      code: "LOW_SAMPLE",
      label: "Limited history",
      detail: `Only ${market.observationCount} KTC observation(s) recorded`,
    });
  } else if (market.observationCount >= 6 && !market.isStale && volatility < 0.15) {
    confidence = "HIGH";
  }
  if (market.isStale) {
    confidence = confidence === "HIGH" ? "MEDIUM" : "LOW";
    reasonCodes.push({
      code: "STALE_DATA",
      label: "Stale data",
      detail: "No confirmed KTC value in the last 48 hours",
    });
  }

  // --- Signal determination ------------------------------------------------
  let signal: SignalType = "HOLD";

  if (market.observationCount < 3) {
    signal = "WATCH";
  } else if (flagged) {
    signal = ctx.slot === "STARTER" ? "HOLD" : "WATCH";
  } else if (
    nearHigh &&
    (pct7d > 5 || pct30d > 10) &&
    (needState === "SURPLUS" || ctx.slot === "BENCH" || ctx.slot === "TAXI") &&
    score >= 70
  ) {
    signal = "SELL_HIGH";
  } else if (
    bigDrawdown &&
    ctx.slot !== "IR" &&
    needState !== "SURPLUS" &&
    !flagged &&
    (market.currentValue ?? 0) >= 800
  ) {
    signal = "BUY_LOW";
  } else if (
    (market.currentValue ?? 9999) < 1000 &&
    pct30d < -10 &&
    (ctx.slot === "BENCH" || ctx.slot === "TAXI") &&
    needState === "SURPLUS"
  ) {
    signal = "CUT_BAIT";
  } else if (volatility > 0.25 && market.observationCount < 6) {
    signal = "WATCH";
  } else {
    signal = "HOLD";
    reasonCodes.push({
      code: "STABLE",
      label: "No compelling edge",
      detail: "Value and roster role don't currently support a directional call",
    });
  }

  return { signal, score, confidence, reasonCodes };
}
