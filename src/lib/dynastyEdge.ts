export type EdgeConfidence = "LOW" | "MEDIUM" | "HIGH";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Recent fantasy volume is evidence, but it is not the same thing as durable
 * dynasty value. This factor limits how much football production can move a
 * player away from two current dynasty markets. It deliberately falls quickly
 * for aging assets, where one productive season says little about resale value
 * or multi-year role security.
 */
export function dynastyHorizonReliability(
  position: string,
  age: number | null,
  games: number,
) {
  const sample = games >= 12 ? 1 : games >= 8 ? 0.78 : games >= 6 ? 0.58 : 0.3;
  if (age === null) return sample * 0.45;

  let horizon = 0.5;
  if (position === "QB") {
    horizon = age <= 30 ? 1 : age <= 32 ? 0.82 : age <= 33 ? 0.62 : age <= 35 ? 0.38 : 0.18;
  } else if (position === "RB") {
    horizon = age <= 23 ? 1 : age <= 24 ? 0.82 : age <= 25 ? 0.62 : age <= 26 ? 0.42 : age <= 27 ? 0.25 : 0.1;
  } else if (position === "WR") {
    horizon = age <= 25 ? 1 : age <= 27 ? 0.86 : age <= 28 ? 0.66 : age <= 29 ? 0.46 : age <= 30 ? 0.28 : 0.1;
  } else if (position === "TE") {
    horizon = age <= 27 ? 1 : age <= 29 ? 0.82 : age <= 30 ? 0.6 : age <= 31 ? 0.38 : 0.16;
  }
  return sample * horizon;
}

export function decisionGradeConfidence(games: number): EdgeConfidence {
  if (games >= 12) return "HIGH";
  if (games >= 6) return "MEDIUM";
  return "LOW";
}

export function calculateDynastyEdge(input: {
  position: string;
  age: number | null;
  games: number;
  currentValue: number;
  consensusValue: number;
  footballValue: number;
}) {
  const current = Math.max(1, input.currentValue);
  const marketGap = clamp((input.consensusValue - current) / current, -0.25, 0.25);
  const footballGap = clamp((input.footballValue - input.consensusValue) / current, -0.35, 0.35);
  const reliability = dynastyHorizonReliability(input.position, input.age, input.games);

  // Two fresh dynasty markets drive 70% of the disagreement. Football evidence
  // can add information, but only after sample size and dynasty horizon reduce it.
  const boundedEdge = clamp(marketGap * 0.7 + footballGap * 0.3 * reliability, -0.25, 0.2);
  const modelValue = Math.round(current * (1 + boundedEdge));
  const modelEdge = modelValue - input.currentValue;
  return {
    modelValue,
    modelEdge,
    modelEdgePercent: (modelEdge / current) * 100,
    reliability,
  };
}
