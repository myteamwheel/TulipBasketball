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

/**
 * Applies evidence gates to the raw predictive model.
 *
 * The underlying model intentionally produces a row for every market-valued
 * player, but missing, stale or undersized football/profile samples must not be
 * interpreted as current football evidence. This wrapper neutralizes
 * independent-value claims when the evidence cannot support a positional peer
 * valuation and blocks football-leading labels until there are enough recent
 * same-position production peers for a meaningful percentile comparison.
 */
export async function getDecisionGradePredictiveModels(
  requestedIds?: string[],
): Promise<Map<string, PredictivePlayerModel>> {
  const models = await getPredictivePlayerModels(requestedIds);
  const currentYear = new Date().getUTCFullYear();
  const peerCounts = new Map<string, number>();

  for (const row of models.values()) {
    if (!isDecisionGradeProductionSeason(row.latestSeason, row.games, currentYear)) continue;
    peerCounts.set(row.position, (peerCounts.get(row.position) ?? 0) + 1);
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
    // treated as current evidence. The historical production remains visible on
    // the player page, but it cannot drive a present-tense fair-value edge,
    // football-leading label or high-confidence forecast.
    if (productionIsStale) {
      const { modelValue, modelEdge, modelEdgePercent } = neutralMarketModel(row);
      const seasonAge = row.latestSeason === null ? null : currentYear - row.latestSeason;
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
          `Independent football valuation is withheld: the latest regular-season production is from ${row.latestSeason}${seasonAge !== null ? ` (${seasonAge} seasons behind the current ${currentYear} season)` : ""}.`,
          "Older production remains descriptive history, but it is not treated as current evidence after a player misses a full regular season.",
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
