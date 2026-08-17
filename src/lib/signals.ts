import type { PlayerMarketData } from "@/lib/metrics";

export type SignalType = "SELL_HIGH" | "HOLD" | "BUY_LOW" | "CUT_BAIT" | "WATCH";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";
export interface ReasonCode { code: string; label: string; detail: string; }
export interface SignalResult { signal: SignalType; score: number; confidence: Confidence; reasonCodes: ReasonCode[]; }
export interface RosterContext {
  slot: "STARTER" | "BENCH" | "TAXI" | "IR";
  position: string;
  status: string | null;
  positionRank: number;
  leagueTeamCount: number;
}

const INJURY_FLAGS = new Set(["Out", "IR", "PUP", "Suspended", "NA"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function rosterNeedState(ctx: RosterContext): "SURPLUS" | "NEUTRAL" | "NEED" {
  if (ctx.positionRank <= Math.max(3, Math.ceil(ctx.leagueTeamCount / 3))) return "SURPLUS";
  if (ctx.positionRank >= Math.max(8, Math.ceil(ctx.leagueTeamCount * 0.7))) return "NEED";
  return "NEUTRAL";
}

function timeNormalizedVolatility(points: PlayerMarketData["sparkline"]): { volatility: number; spanDays: number } {
  const recent = points.slice(-12);
  if (recent.length < 3) return { volatility: 0, spanDays: 0 };
  const changes: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1]; const next = recent[i];
    if (!prev.value) continue;
    const days = Math.max(0.25, (new Date(next.observedAt).getTime() - new Date(prev.observedAt).getTime()) / DAY_MS);
    changes.push(((next.value - prev.value) / prev.value) / Math.sqrt(days));
  }
  if (!changes.length) return { volatility: 0, spanDays: 0 };
  const mean = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  const volatility = Math.sqrt(changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / changes.length);
  const spanDays = Math.max(0, (new Date(recent[recent.length - 1].observedAt).getTime() - new Date(recent[0].observedAt).getTime()) / DAY_MS);
  return { volatility, spanDays };
}

export function computeSignal(market: PlayerMarketData, ctx: RosterContext): SignalResult {
  const reasonCodes: ReasonCode[] = [];
  const pct7d = market.change7d?.percent ?? 0;
  const pct30d = market.change30d?.percent ?? 0;
  const hasReliableMomentumWindow = market.change7d !== null || market.change30d !== null;
  const avgMomentumPct = market.change7d && market.change30d ? 0.6 * pct7d + 0.4 * pct30d : market.change7d ? pct7d : market.change30d ? pct30d : 0;
  const momentumScore = hasReliableMomentumWindow ? clamp(50 + avgMomentumPct * 2, 0, 100) : 50;
  if (market.change7d) reasonCodes.push({ code: pct7d >= 0 ? "MOMENTUM_UP_7D" : "MOMENTUM_DOWN_7D", label: `7-day momentum ${pct7d >= 0 ? "up" : "down"}`, detail: `${pct7d >= 0 ? "+" : ""}${pct7d.toFixed(1)}% over a valid 7-day window` });
  if (market.change30d) reasonCodes.push({ code: pct30d >= 0 ? "MOMENTUM_UP_30D" : "MOMENTUM_DOWN_30D", label: `30-day momentum ${pct30d >= 0 ? "up" : "down"}`, detail: `${pct30d >= 0 ? "+" : ""}${pct30d.toFixed(1)}% over a valid 30-day window` });
  if (!hasReliableMomentumWindow) reasonCodes.push({ code: "WINDOW_GAP", label: "Recent window unavailable", detail: "No valid 7-day or 30-day comparison exists, so no momentum call is made." });

  const hasDecisionRange = market.high !== null && market.distanceFromHigh !== null;
  const distFromHighPct = market.distanceFromHigh?.percent ?? 0;
  const proximityScore = hasDecisionRange ? clamp(100 + distFromHighPct * 1.5, 0, 100) : 50;
  const nearHigh = hasDecisionRange && distFromHighPct >= -10;
  const bigDrawdown = hasDecisionRange && distFromHighPct <= -30;
  if (hasDecisionRange && market.high) reasonCodes.push({ code: nearHigh ? "NEAR_TRACKED_HIGH" : bigDrawdown ? "LARGE_DRAWDOWN" : "MID_RANGE", label: nearHigh ? "Near tracked high" : bigDrawdown ? "Large drawdown from peak" : "Mid-range from peak", detail: `${distFromHighPct.toFixed(1)}% from decision-grade tracked high of ${market.high.value}` });

  const needState = rosterNeedState(ctx);
  let rosterScore = 50;
  if (needState === "SURPLUS") rosterScore += 20;
  if (needState === "NEED") rosterScore -= 20;
  if (ctx.slot === "BENCH" || ctx.slot === "TAXI") rosterScore += 8;
  if (ctx.slot === "STARTER") rosterScore -= 8;
  if (ctx.slot === "IR") rosterScore -= 15;
  rosterScore = clamp(rosterScore, 0, 100);
  reasonCodes.push({ code: `ROSTER_${needState}_${ctx.position}`, label: `${needState === "SURPLUS" ? "League strength" : needState === "NEED" ? "League weakness" : "Middle-tier"} at ${ctx.position}`, detail: `#${ctx.positionRank}/${ctx.leagueTeamCount} in starter-quality ${ctx.position} capital` });

  let statusScore = 60;
  const flagged = ctx.status ? INJURY_FLAGS.has(ctx.status) : false;
  if (flagged) { statusScore = 15; reasonCodes.push({ code: "STATUS_FLAG", label: "Availability flag", detail: `Sleeper reports ${ctx.status}` }); }

  const { volatility, spanDays } = timeNormalizedVolatility(market.sparkline);
  const score = Math.round(momentumScore * 0.35 + proximityScore * 0.25 + rosterScore * 0.25 + statusScore * 0.15);
  const anchorMs = market.currentObservedAt ? new Date(market.currentObservedAt).getTime() : Date.now();
  const recent14Count = market.sparkline.filter((point) => anchorMs - new Date(point.observedAt).getTime() <= 14 * DAY_MS).length;

  let confidence: Confidence = "MEDIUM";
  if (market.observationCount < 3 || market.dataAgeMs === null || recent14Count < 2 || !hasReliableMomentumWindow || spanDays < 3) confidence = "LOW";
  else if (market.observationCount >= 6 && recent14Count >= 3 && spanDays >= 7 && !market.isStale && volatility < 0.12) confidence = "HIGH";
  if (market.isStale) { confidence = "LOW"; reasonCodes.push({ code: "STALE_DATA", label: "Stale KTC anchor", detail: "The latest KTC observation is outside the dashboard freshness window." }); }

  let signal: SignalType = "HOLD";
  if (market.isStale || market.observationCount < 3 || !hasReliableMomentumWindow || recent14Count < 2 || spanDays < 3) signal = "WATCH";
  else if (flagged) signal = ctx.slot === "STARTER" ? "HOLD" : "WATCH";
  else if (nearHigh && (pct7d > 5 || pct30d > 10) && (needState === "SURPLUS" || ctx.slot === "BENCH" || ctx.slot === "TAXI") && score >= 70) signal = "SELL_HIGH";
  else if (bigDrawdown && ctx.slot !== "IR" && needState !== "SURPLUS" && !flagged && (market.currentValue ?? 0) >= 800) signal = "BUY_LOW";
  else if ((market.currentValue ?? 9999) < 1000 && market.change30d !== null && pct30d < -10 && (ctx.slot === "BENCH" || ctx.slot === "TAXI") && needState === "SURPLUS") signal = "CUT_BAIT";
  else if (volatility > 0.2 && market.observationCount < 6) signal = "WATCH";
  else reasonCodes.push({ code: "STABLE", label: "No compelling edge", detail: "Current value, valid recent movement, and league-relative roster context do not support a directional action." });
  return { signal, score, confidence, reasonCodes };
}
