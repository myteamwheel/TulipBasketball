// Incoming players need an active spot; transferring IR/taxi eligibility is not assumed.
export function fitsRoster(current: number, outgoingActive: number, incomingPlayers: number, limit: number) {
  return current - outgoingActive + incomingPlayers <= limit;
}
export function boundedTradeFitScore(score: number) {
  if (!Number.isFinite(score)) return 1;
  return Math.max(1, Math.min(92, Math.round(score)));
}
type AssetEvidence = { isPick: boolean; age: number | null; position: string; hasProjection: boolean; value: number; needed: boolean };
export function windowMotive(window: string, incoming: AssetEvidence[], outgoingValue: number): string | null {
  const meaningful = incoming.filter(a => a.value >= outgoingValue * .35);
  if (window === "REBUILDER") {
    if (meaningful.some(a => a.isPick || (a.age !== null && a.age <= (a.position === "QB" ? 27 : a.position === "TE" ? 25 : 24)))) return "Rebuilding fit: receives meaningful young-player or draft-pick value.";
    return null;
  }
  if (window === "CONTENDER") {
    if (meaningful.some(a => !a.isPick && a.hasProjection && a.needed)) return "Contending fit: receives current weekly production at a position of need.";
    return null;
  }
  return meaningful.some(a => a.isPick || (a.hasProjection && a.needed)) ? "Balanced fit: receives draft flexibility or weekly production at a position of need." : null;
}
