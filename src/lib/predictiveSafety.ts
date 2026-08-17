import {
  getPredictivePlayerModels,
  type PredictivePlayerModel,
  type ValueForecast,
} from "@/lib/predictive";

const MIN_POSITIONAL_FOOTBALL_PEERS = 8;
const MAX_PRODUCTION_SEASON_AGE = 1;

function round(value: number) {
  return Math.round(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function quantile(values: number[], q: number) {
  const xs = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return 0;
  if (xs.length === 1) return xs[0];
  const p = clamp(q, 0, 1) * (xs.length - 1);
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  const fraction = p - lo;
  return xs[lo] + (xs[hi] - xs[lo]) * fraction;
}

function percentile(value: number | null, values: number[]) {
  if (value === null || !Number.isFinite(value)) return 0.5;
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return 0.5;
  const below = clean.filter((peer) => peer < value).length;
  const equal = clean.filter((peer) => peer === value).length;
  return clamp((below + equal * 0.5) / clean.length, 0.02, 0.98);
}

function ageScore(position: string, age: number | null) {
  if (age === null) return 0.5;
  if (position === "QB") {
    if (age <= 24) return 0.9;
    if (age <= 30) return 1;
    if (age <= 33) return 0.86;
    if (age <= 36) return 0.62;
    return 0.34;
  }
  if (position === "RB") {
    if (age <= 22) return 1;
    if (age <= 23) return 0.95;
    if (age <= 24) return 0.85;
    if (age <= 25) return 0.7;
    if (age <= 26) return 0.55;
    if (age <= 27) return 0.38;
    if (age <= 28) return 0.22;
    return 0.1;
  }
  if (position === "WR") {
    if (age <= 22) return 0.95;
    if (age <= 25) return 1;
    if (age <= 27) return 0.9;
    if (age <= 28) return 0.75;
    if (age <= 29) return 0.58;
    if (age <= 30) return 0.4;
    return 0.2;
  }
  if (position === "TE") {
    if (age <= 23) return 0.8;
    if (age <= 27) return 1;
    if (age <= 29) return 0.9;
    if (age <= 30) return 0.7;
    if (age <= 31) return 0.55;
    return 0.3;
  }
  return 0.5;
}

function draftScore(roundValue: number | null, yearsSinceDraft: number | null) {
  let base = 0.18;
  if (roundValue === 1) base = 1;
  else if (roundValue === 2) base = 0.84;
  else if (roundValue === 3) base = 0.68;
  else if (roundValue === 4) base = 0.54;
  else if (roundValue === 5) base = 0.42;
  else if (roundValue === 6) base = 0.33;
  else if (roundValue === 7) base = 0.26;
  if (yearsSinceDraft === null) return base;
  let weight = 0.2;
  if (yearsSinceDraft <= 1) weight = 1;
  else if (yearsSinceDraft === 2) weight = 0.8;
  else if (yearsSinceDraft === 3) weight = 0.6;
  else if (yearsSinceDraft <= 5) weight = 0.4;
  return 0.5 + (base - 0.5) * weight;
}

function marketImpliedPpg(position: string, value: number) {
  const x = Math.pow(clamp(value / 10000, 0, 1), 0.76);
  if (position === "QB") return 10.5 + 13 * x;
  if (position === "RB") return 3 + 14 * x;
  if (position === "WR") return 3 + 14.5 * x;
  if (position === "TE") return 2.5 + 12.5 * x;
  return 3 + 10 * x;
}

function recenterForecast(forecast: ValueForecast, mean: number): ValueForecast {
  const oldMean = Math.max(1, forecast.mean);
  const lowRatio = Math.max(0.05, forecast.low / oldMean);
  const highRatio = Math.max(1, forecast.high / oldMean);
  return {
    mean: round(mean),
    low: round(Math.max(50, mean * lowRatio)),
    high: round(Math.min(10000, mean * highRatio)),
  };
}

function neutralMarketModel(row: PredictivePlayerModel) {
  const consensus = row.consensusValue ?? row.currentValue;
  const modelValue = round(row.currentValue * 0.85 + consensus * 0.15);
  const modelEdge = modelValue - row.currentValue;
  const modelEdgePercent = row.currentValue > 0 ? (modelEdge / row.currentValue) * 100 : 0;
  return { modelValue, modelEdge, modelEdgePercent };
}

export function isDecisionGradeProductionSeason(
  latestSeason: number | null,
  games: number,
  currentYear = new Date().getUTCFullYear(),
) {
  return (
    latestSeason !== null &&
    games >= 3 &&
    latestSeason >= currentYear - MAX_PRODUCTION_SEASON_AGE
  );
}

type RecentPeerPool = {
  ppg: number[];
  opportunity: number[];
  efficiency: number[];
  market: number[];
};

/**
 * Applies evidence gates to the raw predictive model.
 *
 * The underlying model intentionally produces a row for every market-valued
 * player, but missing, stale or undersized football/profile samples must not be
 * interpreted as current football evidence. This wrapper neutralizes
 * independent-value claims when the evidence cannot support a positional peer
 * valuation and blocks football-leading labels until there are enough recent
 * same-position production peers for a meaningful percentile comparison.
 *
 * Importantly, decision-grade players are re-percentiled here against only
 * decision-grade recent peers. A stale season is therefore excluded from the
 * benchmark population itself, rather than merely neutralizing that stale
 * player's final recommendation after it has already influenced everyone else.
 */
export async function getDecisionGradePredictiveModels(
  requestedIds?: string[],
): Promise<Map<string, PredictivePlayerModel>> {
  const models = await getPredictivePlayerModels(requestedIds);
  const currentYear = new Date().getUTCFullYear();
  const peerCounts = new Map<string, number>();
  const recentPeers = new Map<string, RecentPeerPool>();

  for (const row of models.values()) {
    if (!isDecisionGradeProductionSeason(row.latestSeason, row.games, currentYear)) continue;
    peerCounts.set(row.position, (peerCounts.get(row.position) ?? 0) + 1);
    const pool = recentPeers.get(row.position) ?? {
      ppg: [],
      opportunity: [],
      efficiency: [],
      market: [],
    };
    if (row.fantasyPpg !== null && Number.isFinite(row.fantasyPpg)) pool.ppg.push(row.fantasyPpg);
    if (row.opportunityPerGame !== null && Number.isFinite(row.opportunityPerGame)) {
      pool.opportunity.push(row.opportunityPerGame);
    }
    if (Number.isFinite(row.efficiencyScore)) {
      // Raw efficiencyScore is already a percentile and cannot be inverted to
      // the underlying efficiency rate. Do not re-percentile that percentile;
      // retain it below while rebuilding production/usage against clean peers.
      pool.efficiency.push(row.efficiencyScore);
    }
    pool.market.push(row.currentValue);
    recentPeers.set(row.position, pool);
  }

  const guarded = new Map<string, PredictivePlayerModel>();
  for (const [playerId, row] of models) {
    const hasProfileEvidence = row.age !== null || row.draftYear !== null || row.draftRound !== null;
    const hasProduction = row.games >= 3;
    const hasRecentProduction = isDecisionGradeProductionSeason(
      row.latestSeason,
      row.games,
      currentYear,
    );
    const productionIsStale = hasProduction && !hasRecentProduction;
    const positionalPeerCount = peerCounts.get(row.position) ?? 0;
    const peerSampleAdequate = positionalPeerCount >= MIN_POSITIONAL_FOOTBALL_PEERS;

    let next = row;

    // Rebuild the football peer valuation against recent peers only. This
    // prevents a 2024-only player, for example, from shifting the percentile of
    // a current 2025/2026 producer before the stale player's own row is gated.
    if (hasRecentProduction && peerSampleAdequate) {
      const pool = recentPeers.get(row.position);
      if (pool) {
        const productionScore = percentile(row.fantasyPpg, pool.ppg);
        const usageScore = percentile(row.opportunityPerGame, pool.opportunity);
        const efficiencyScore = row.efficiencyScore;
        const yearsSinceDraft = row.draftYear === null ? null : Math.max(0, currentYear - row.draftYear);
        const fundamentalScore = clamp(
          productionScore * 0.3 +
            usageScore * 0.25 +
            efficiencyScore * 0.1 +
            ageScore(row.position, row.age) * 0.2 +
            draftScore(row.draftRound, yearsSinceDraft) * 0.15,
          0.03,
          0.97,
        );
        const fundamentalValue = round(clamp(quantile(pool.market, fundamentalScore), 50, 10000));
        const consensus = row.consensusValue ?? row.currentValue;
        const modelValue = round(
          clamp(row.currentValue * 0.45 + consensus * 0.15 + fundamentalValue * 0.4, 50, 10000),
        );
        const modelEdge = modelValue - row.currentValue;
        const modelEdgePercent = row.currentValue > 0 ? (modelEdge / row.currentValue) * 100 : 0;
        next = {
          ...row,
          productionScore,
          usageScore,
          fundamentalScore,
          fundamentalValue,
          modelValue,
          modelEdge,
          modelEdgePercent,
          forecast30d: recenterForecast(row.forecast30d, modelValue),
          forecastRos: recenterForecast(row.forecastRos, modelValue),
          forecast1y: recenterForecast(row.forecast1y, modelValue),
          forecast3y: recenterForecast(row.forecast3y, modelValue),
          reasons: [
            `Football peer value is benchmarked against ${positionalPeerCount} recent decision-grade ${row.position} peers; stale seasons are excluded from the comparison population.`,
            ...row.reasons.filter((reason) => !reason.startsWith("Football-only peer value")),
          ].slice(0, 4),
        };
      }
    }

    // Unknown profile != bad draft capital. If both profile and production are
    // absent, the independent component is unobserved and should be neutral.
    if (!hasProfileEvidence && !hasProduction) {
      const { modelValue, modelEdge, modelEdgePercent } = neutralMarketModel(row);

      next = {
        ...row,
        fundamentalValue: row.currentValue,
        fundamentalScore: 0.5,
        productionScore: 0.5,
        usageScore: 0.5,
        efficiencyScore: 0.5,
        modelValue,
        modelEdge,
        modelEdgePercent,
        forecast30d: recenterForecast(row.forecast30d, modelValue),
        forecastRos: recenterForecast(row.forecastRos, modelValue),
        forecast1y: recenterForecast(row.forecast1y, modelValue),
        forecast3y: recenterForecast(row.forecast3y, modelValue),
        confidence: "LOW",
        mispricingQuadrant: "MARKET_ONLY",
        reasons: [
          "Independent football value is neutral because no usable production or player profile is loaded yet; missing data is not treated as negative evidence.",
          ...row.reasons.filter((reason) => !reason.startsWith("Football-only peer value")),
        ].slice(0, 4),
      };
    }

    // A player who missed an entire regular season cannot have an older sample
    // treated as current evidence. Historical production remains visible, but it
    // cannot drive current fair value, lineup projection, football-leading labels,
    // or high-confidence forecasts.
    if (productionIsStale) {
      const { modelValue, modelEdge, modelEdgePercent } = neutralMarketModel(row);
      const seasonAge = row.latestSeason === null ? null : currentYear - row.latestSeason;
      const projectedWeeklyPoints = Number(marketImpliedPpg(row.position, row.currentValue).toFixed(1));
      next = {
        ...next,
        fundamentalValue: row.currentValue,
        fundamentalScore: 0.5,
        productionScore: 0.5,
        usageScore: 0.5,
        efficiencyScore: 0.5,
        modelValue,
        modelEdge,
        modelEdgePercent,
        projectedWeeklyPoints,
        forecast30d: recenterForecast(next.forecast30d, modelValue),
        forecastRos: recenterForecast(next.forecastRos, modelValue),
        forecast1y: recenterForecast(next.forecast1y, modelValue),
        forecast3y: recenterForecast(next.forecast3y, modelValue),
        confidence: "LOW",
        mispricingQuadrant: "MARKET_ONLY",
        reasons: [
          `Independent football valuation is withheld: the latest regular-season production is from ${row.latestSeason}${seasonAge !== null ? ` (${seasonAge} seasons behind the current ${currentYear} season)` : ""}.`,
          "Older production remains descriptive history, but current lineup projection reverts to a market-implied role estimate rather than carrying stale PPG into the season simulation.",
          ...next.reasons.filter(
            (reason) =>
              !reason.startsWith("Football-only peer value") &&
              !reason.includes("production:") &&
              !reason.includes("opportunity percentile"),
          ),
        ].slice(0, 4),
      };
    }

    // A percentile based on only a handful of recent same-position players is
    // not a valid independent valuation. Neutralize that valuation until the
    // peer pool is large enough; observed production can remain descriptive,
    // but it cannot manufacture a cross-player fair-value signal.
    if (hasRecentProduction && !peerSampleAdequate) {
      const { modelValue, modelEdge, modelEdgePercent } = neutralMarketModel(row);
      next = {
        ...next,
        fundamentalValue: row.currentValue,
        fundamentalScore: 0.5,
        productionScore: 0.5,
        usageScore: 0.5,
        efficiencyScore: 0.5,
        modelValue,
        modelEdge,
        modelEdgePercent,
        forecast30d: recenterForecast(next.forecast30d, modelValue),
        forecastRos: recenterForecast(next.forecastRos, modelValue),
        forecast1y: recenterForecast(next.forecast1y, modelValue),
        forecast3y: recenterForecast(next.forecast3y, modelValue),
        confidence: "LOW",
        mispricingQuadrant: "MARKET_ONLY",
        reasons: [
          `Independent football valuation is withheld: only ${positionalPeerCount} ${row.position} players currently have recent usable production; ${MIN_POSITIONAL_FOOTBALL_PEERS}+ are required for a decision-grade same-position peer sample.`,
          "Until that threshold is met, model value is anchored to current/trusted market evidence instead of a tiny-sample percentile.",
          ...next.reasons.filter((reason) => !reason.startsWith("Football-only peer value")),
        ].slice(0, 4),
      };
    }

    guarded.set(playerId, next);
  }

  return guarded;
}

export const DECISION_GRADE_POSITIONAL_PEER_MINIMUM = MIN_POSITIONAL_FOOTBALL_PEERS;
export const DECISION_GRADE_MAX_PRODUCTION_SEASON_AGE = MAX_PRODUCTION_SEASON_AGE;
