import type { LeagueHistory } from './leagueHistorySource';
export function historicalManager(history: LeagueHistory, leagueId: string, rosterId: number) {
  const season = history.seasons.find(s => s.leagueId === leagueId);
  const manager = season?.managers.find(m => m.rosterId === rosterId);
  return { key: manager?.ownerId ? 'owner:' + manager.ownerId : `${leagueId}:roster:${rosterId}`, name: manager?.name ?? `Team ${rosterId}` };
}
export function resolveDraftPick(history: LeagueHistory, season: string, round: number, originalRoster: number) {
  const drafts = history.seasons.filter(s => s.season === season).flatMap(s => s.drafts).filter(d => d.completed && d.season === season);
  const matches = drafts.flatMap(d => d.picks.filter(p => p.round === round && Number(d.slotToRoster[String(p.slot)]) === originalRoster).map(p => ({ ...p, draftId: d.id })));
  // Multiple drafts or absent original-slot mapping require human review, never guessing by final owner.
  return matches.length === 1 ? matches[0] : null;
}
