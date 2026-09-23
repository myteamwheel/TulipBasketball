export type FantasyScoringSettings = {
  reception: number;
  passingYard: number;
  passingTd: number;
  interception: number;
  rushingYard: number;
  rushingTd: number;
  receivingYard: number;
  receivingTd: number;
  fumbleLost: number;
};

export type FantasyStatLine = {
  passingYards: number;
  passingTds: number;
  interceptions: number;
  rushingYards: number;
  rushingTds: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
  fumblesLost: number;
};

export const VERIFIED_DYNASTY_BOIS_SCORING: FantasyScoringSettings = {
  reception: 0.5,
  passingYard: 0.04,
  passingTd: 4,
  interception: -1,
  rushingYard: 0.1,
  rushingTd: 6,
  receivingYard: 0.1,
  receivingTd: 6,
  fumbleLost: -2,
};

const finite = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function scoringFromSleeperSettings(
  settings: Record<string, number> | null | undefined,
): FantasyScoringSettings {
  const fallback = VERIFIED_DYNASTY_BOIS_SCORING;
  return {
    reception: finite(settings?.rec, fallback.reception),
    passingYard: finite(settings?.pass_yd, fallback.passingYard),
    passingTd: finite(settings?.pass_td, fallback.passingTd),
    interception: finite(settings?.pass_int, fallback.interception),
    rushingYard: finite(settings?.rush_yd, fallback.rushingYard),
    rushingTd: finite(settings?.rush_td, fallback.rushingTd),
    receivingYard: finite(settings?.rec_yd, fallback.receivingYard),
    receivingTd: finite(settings?.rec_td, fallback.receivingTd),
    fumbleLost: finite(settings?.fum_lost, fallback.fumbleLost),
  };
}

export function scoringFromStoredLeagueSettings(
  raw: string | null | undefined,
): FantasyScoringSettings {
  if (!raw) return VERIFIED_DYNASTY_BOIS_SCORING;
  try {
    const parsed = JSON.parse(raw) as {
      scoring_settings?: Record<string, number>;
    };
    return scoringFromSleeperSettings(parsed.scoring_settings);
  } catch {
    return VERIFIED_DYNASTY_BOIS_SCORING;
  }
}

export function scoreFantasyStats(
  stats: FantasyStatLine,
  scoring: FantasyScoringSettings = VERIFIED_DYNASTY_BOIS_SCORING,
) {
  return (
    stats.passingYards * scoring.passingYard +
    stats.passingTds * scoring.passingTd +
    stats.interceptions * scoring.interception +
    stats.rushingYards * scoring.rushingYard +
    stats.rushingTds * scoring.rushingTd +
    stats.receptions * scoring.reception +
    stats.receivingYards * scoring.receivingYard +
    stats.receivingTds * scoring.receivingTd +
    stats.fumblesLost * scoring.fumbleLost
  );
}

const SUPPORTED_SLEEPER_SCORING_KEYS = new Set([
  "rec",
  "pass_yd",
  "pass_td",
  "pass_int",
  "rush_yd",
  "rush_td",
  "rec_yd",
  "rec_td",
  "fum_lost",
]);

export function unsupportedNonzeroScoring(
  settings: Record<string, number> | null | undefined,
) {
  if (!settings) return [] as Array<{ key: string; value: number }>;
  return Object.entries(settings)
    .filter(
      ([key, value]) =>
        !SUPPORTED_SLEEPER_SCORING_KEYS.has(key) &&
        Number.isFinite(Number(value)) &&
        Number(value) !== 0,
    )
    .map(([key, value]) => ({ key, value: Number(value) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
