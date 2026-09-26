export function isDecisionGradeProductionSeason(latestSeason: number | null, games: number, currentYear = new Date().getUTCFullYear()) {
  return latestSeason !== null && games >= 3 && latestSeason >= currentYear - 1 && latestSeason <= currentYear;
}
