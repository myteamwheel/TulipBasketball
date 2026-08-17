import {
  getPredictivePlayerModels,
  type PredictivePlayerModel,
  type ValueForecast,
} from "@/lib/predictive";

const MIN_POSITIONAL_FOOTBALL_PEERS = 8;

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

/**
 * Applies evidence gates to the raw predictive model.
 *
 * The underlying model intentionally produces a row for every market-valued
 * player, but missing football/profile data must not be interpreted as
 * negative football evidence. This wrapper neutralizes independent-value
 * claims when the player has no profile and no usable production, and blocks
 * football-leading labels until there are enough same-position production
 * peers for a meaningful percentile comparison.
 */
export async function getDecisionGradePredictiveModels(
  requestedIds?: string[],
): Promise<Map<string, PredictivePlayerModel>> {
  const models = await getPredictivePlayerModels(requestedIds);
  const peerCounts = new Map<string, number>();

  for (const row of models.values()) {
    if (row.games < 3) continue;
    peerCounts.set(row.position, (peerCounts.get(row.position) ?? 0) + 1);
  }

  const guarded = new Map<string, PredictivePlayerModel>();
  for (const [playerId, row] of models) {
    const hasProfileEvidence = row.age !== null || row.draftYear !== null || row.draftRound !== null;
    const hasProduction = row.games >= 3;
    const positionalPeerCount = peerCounts.get(row.position) ?? 0;
    const peerSampleAdequate = positionalPeerCount >= MIN_POSITIONAL_FOOTBALL_PEERS;

    let next = row;

    // Unknown profile != bad draft capital. If both profile and production are
    // absent, the independent component is unobserved and should be neutral.
    if (!hasProfileEvidence && !hasProduction) {
      const consensus = row.consensusValue ?? row.currentValue;
      const modelValue = round(row.currentValue * 0.85 + consensus * 0.15);
      const modelEdge = modelValue - row.currentValue;
      const modelEdgePercent = row.currentValue > 0 ? (modelEdge / row.currentValue) * 100 : 0;

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

    // A percentile based on only a handful of same-position players is not a
    // decision-grade football signal, even when the player's own sample exists.
    if (hasProduction && !peerSampleAdequate) {
      next = {
        ...next,
        confidence: "LOW",
        mispricingQuadrant: "MARKET_ONLY",
        reasons: [
          `Football sample is provisional: only ${positionalPeerCount} ${row.position} players currently have usable production; ${MIN_POSITIONAL_FOOTBALL_PEERS}+ are required for decision-grade peer comparisons.`,
          ...next.reasons,
        ].slice(0, 4),
      };
    }

    guarded.set(playerId, next);
  }

  return guarded;
}

export const DECISION_GRADE_POSITIONAL_PEER_MINIMUM = MIN_POSITIONAL_FOOTBALL_PEERS;
