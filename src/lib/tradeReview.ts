import { calculateTradeSideGrades } from "./tradeGrades";
import type { TradeGradePhase, TradeSnapshotTiming } from "@/lib/tradeGrades";

export type ReviewAsset = {
  id: string;
  playerId: string | null;
  label: string;
  assetType: "player" | "pick";
  atTradeValue: number | null;
  currentValue: number | null;
  currentValueIsRetired?: boolean;
  retiredSource?: string;
  priceSource?: string;
  historicalDaily?: import("./historicalKtc").DailyTradePrice;
  outcome?: { label: string; playerId: string | null; sleeperId: string; pickNumber: number; currentValue: number | null; sourceUrl: string };
  journey?: { tradeId: string; date: string; label: string }[];
  currentObservedAt?: string | null;
  atMoveObservedAt: string | null;
  atMoveTiming: TradeSnapshotTiming | null;
};
export type ReviewSide = {
  rosterId: number;
  identityKey?: string;
  onField?: import("./tradeOnField").OnFieldContribution | null;
  onFieldCheckedAt?: string;
  name: string;
  gave: ReviewAsset[];
  got: ReviewAsset[];
  faabSent?: number;
  faabReceived?: number;
  grades: { atTrade: TradeGradePhase; current: TradeGradePhase } | null;
};
export type ReviewTrade = { id: string; date: string; season?: string; sides: ReviewSide[] };
export type ReviewSort = "newest" | "winsThen" | "winsNow" | "outcomeNow" | "improved" | "reversals" | "losses" | "largest" | "unequalThen" | "unequalNow" | "equalThen" | "equalNow";
export type ReviewMetric = "points" | "percent";
export type ReviewFilters = { team: number | null; season: string; opponent: number | null; asset: "all" | "player" | "pick"; faab: "all" | "yes" | "no" };
export type RankedTrade = { trade: ReviewTrade; side: ReviewSide | null; score: number | null };

export function eligiblePhase(side: ReviewSide, phase: "atTrade" | "current"): TradeGradePhase | null {
  const grade = side.grades?.[phase];
  return grade?.status === "READY" && grade.balance ? grade : null;
}

export function tradeWinner(trade: ReviewTrade, phase: "atTrade" | "current"): string {
  const rated = trade.sides.filter(side => eligiblePhase(side, phase));
  if (!rated.length) return "Unavailable";
  if (trade.sides.some(side => side.grades?.[phase].status === "INCOMPLETE" || side.grades === null)) return "Unavailable";
  const winning = rated.filter(side => eligiblePhase(side, phase)?.result === "WON");
  if (winning.length === 1 && trade.sides.length === 2) return winning[0].name;
  if (winning.length > 0) return winning.length === 1 ? winning[0].name : "Multiple teams";
  return rated.length === trade.sides.length ? "Even" : "Unavailable";
}

function phaseEdge(side: ReviewSide, phase: "atTrade" | "current", metric: ReviewMetric): number | null {
  const grade = eligiblePhase(side, phase);
  if (!grade?.balance) return null;
  return metric === "percent" ? grade.balance.edgePercent : grade.balance.adjustedEdge;
}

export function currentOutcomeGrade(side: ReviewSide): TradeGradePhase | null {
  const assets = [...side.got, ...side.gave];
  if (!assets.some(asset => asset.outcome)) return side.grades?.current ?? null;
  const convert = (items: ReviewAsset[]) => items.map(asset => ({
    ...asset,
    currentValue: asset.outcome ? asset.outcome.currentValue : asset.currentValue,
  }));
  return calculateTradeSideGrades({ ...side, got: convert(side.got), gave: convert(side.gave) }).current;
}

export function isBalanceSort(sort: ReviewSort): boolean {
  return sort === "unequalThen" || sort === "unequalNow" || sort === "equalThen" || sort === "equalNow";
}

function tradeValueGap(trade: ReviewTrade, sort: ReviewSort, metric: ReviewMetric): number | null {
  const historical = sort === "unequalThen" || sort === "equalThen";
  const grades = trade.sides.map(side => historical ? side.grades?.atTrade : currentOutcomeGrade(side));
  if (grades.some(grade => !grade || grade.status === "INCOMPLETE")) return null;
  const balances = grades.flatMap(grade => grade?.status === "READY" && grade.balance ? [grade.balance] : []);
  if (!balances.length) return null;
  // Use the largest team gap so a balanced team cannot hide a lopsided multi-team deal.
  return Math.max(...balances.map(balance => Math.abs(metric === "percent" ? balance.edgePercent : balance.adjustedEdge)));
}

export function rankTrades(trades: ReviewTrade[], sort: ReviewSort, metric: ReviewMetric, filters: ReviewFilters): RankedTrade[] {
  const filtered = trades.filter(trade => {
    if (filters.season !== "all" && (trade.season ?? new Date(trade.date).getUTCFullYear().toString()) !== filters.season) return false;
    if (filters.team !== null && !trade.sides.some(side => side.rosterId === filters.team)) return false;
    if (filters.opponent !== null && !trade.sides.some(side => side.rosterId === filters.opponent && side.rosterId !== filters.team)) return false;
    if (filters.asset !== "all" && !trade.sides.some(side => side.got.some(asset => asset.assetType === filters.asset))) return false;
    const hasFaab = trade.sides.some(side => (side.faabSent ?? 0) > 0 || (side.faabReceived ?? 0) > 0);
    if (filters.faab === "yes" && !hasFaab || filters.faab === "no" && hasFaab) return false;
    return true;
  });
  const balanceSort = isBalanceSort(sort);
  const closestFirst = sort === "equalThen" || sort === "equalNow";
  const ranked = filtered.map(trade => {
    if (balanceSort) return { trade, side: null, score: tradeValueGap(trade, sort, metric) };
    const candidates = filters.team === null ? trade.sides : trade.sides.filter(side => side.rosterId === filters.team);
    const scores = candidates.map(side => {
      const then = phaseEdge(side, "atTrade", metric);
      const now = phaseEdge(side, "current", metric);
      let score: number | null = null;
      if (sort === "winsThen") score = then !== null && eligiblePhase(side, "atTrade")?.result === "WON" ? then : null;
      if (sort === "outcomeNow") {
        const outcome = currentOutcomeGrade(side);
        score = outcome?.status === 'READY' && outcome.result === 'WON' && outcome.balance ? (metric === 'percent' ? outcome.balance.edgePercent : outcome.balance.adjustedEdge) : null;
      }
      if (sort === "winsNow") score = now !== null && eligiblePhase(side, "current")?.result === "WON" ? now : null;
      if (sort === "improved") score = then !== null && now !== null && now > then ? now - then : null;
      if (sort === "reversals") score = then !== null && now !== null && then < 0 && now > 0 ? now - then : null;
      if (sort === "losses") score = now !== null && eligiblePhase(side, "current")?.result === "LOST" ? -now : null;
      if (sort === "largest") {
        const phase = trade.sides.every(item => item.grades?.current.status !== "INCOMPLETE" && item.grades !== null) ? "current" : "atTrade";
        score = trade.sides.every(item => item.grades?.[phase].status !== "INCOMPLETE" && item.grades !== null)
          ? trade.sides.reduce((total, item) => total + (eligiblePhase(item, phase)?.balance?.get.adjustedValue ?? 0), 0)
          : null;
        if (score === 0) score = null;
      }
      if (sort === "newest") score = new Date(trade.date).getTime();
      return { side, score };
    }).filter((item): item is { side: ReviewSide; score: number } => item.score !== null && Number.isFinite(item.score));
    scores.sort((a, b) => b.score - a.score);
    return { trade, side: scores[0]?.side ?? null, score: scores[0]?.score ?? null };
  }).filter(row => row.score !== null);
  ranked.sort((a, b) => (closestFirst ? (a.score ?? 0) - (b.score ?? 0) : (b.score ?? 0) - (a.score ?? 0)) || b.trade.date.localeCompare(a.trade.date) || a.trade.id.localeCompare(b.trade.id));
  return ranked;
}

export function coverage(trades: ReviewTrade[]) {
  const total = trades.length;
  const atTrade = trades.filter(trade => trade.sides.some(side => eligiblePhase(side, "atTrade"))).length;
  const current = trades.filter(trade => trade.sides.some(side => eligiblePhase(side, "current"))).length;
  const both = trades.filter(trade => trade.sides.some(side => eligiblePhase(side, "atTrade") && eligiblePhase(side, "current"))).length;
  return { total, atTrade, current, both };
}
