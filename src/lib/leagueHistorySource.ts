import { getAllTransactions, getLeague, getRosters, getUsers, type SleeperTransaction } from './sleeper';
export type HistoryDraft = { season: string; id: string; completed: boolean; slotToRoster: Record<string, number>; picks: { playerId: string; name: string; position: string; round: number; slot: number; overall: number; rosterId: number }[] };
export type HistorySeason = { leagueId: string; season: string; previousLeagueId: string | null; checkedAt: string; complete: boolean; error: string | null; managers: { rosterId: number; ownerId: string | null; name: string }[]; trades: SleeperTransaction[]; drafts: HistoryDraft[] };
export type LeagueHistory = { rootLeagueId: string; checkedAt: string; chainComplete: boolean; seasons: HistorySeason[]; players: Record<string, { name: string; position: string }> };
async function json<T>(path: string): Promise<T> {
  const response = await fetch('https://api.sleeper.app/v1/' + path, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Sleeper history HTTP ${response.status}`);
  return response.json();
}
export async function fetchLeagueHistory(rootLeagueId: string): Promise<LeagueHistory> {
  const seasons: HistorySeason[] = [], seen = new Set<string>();
  let id: string | null = rootLeagueId;
  const players: LeagueHistory['players'] = {};
  while (id && !seen.has(id) && seasons.length < 20) {
    seen.add(id);
    const league = await getLeague(id);
    if (!league?.league_id || league.league_id !== id) throw new Error('Invalid league history identity');
    const season: HistorySeason = { leagueId: id, season: league.season, previousLeagueId: league.previous_league_id, checkedAt: new Date().toISOString(), complete: false, error: null, managers: [], trades: [], drafts: [] };
    try {
      const [rosters, users, transactions, drafts] = await Promise.all([getRosters(id), getUsers(id), getAllTransactions(id, 18), json<{ draft_id: string }[]>(`league/${id}/drafts`)]);
      season.managers = rosters.map(r => ({ rosterId: r.roster_id, ownerId: r.owner_id, name: users.find(u => u.user_id === r.owner_id)?.metadata?.team_name || users.find(u => u.user_id === r.owner_id)?.display_name || `Unassigned roster ${r.roster_id}` }));
      season.trades = transactions.filter(t => t.status === 'complete' && t.type === 'trade');
      for (const draft of drafts) {
        const [detail, picks] = await Promise.all([
          json<{ season: string; status: string; slot_to_roster_id?: Record<string, number> }>(`draft/${draft.draft_id}`),
          json<{ player_id: string; metadata?: { first_name?: string; last_name?: string; position?: string }; round: number; draft_slot: number; pick_no: number; roster_id: number }[]>(`draft/${draft.draft_id}/picks`),
        ]);
        season.drafts.push({ season: detail.season, id: draft.draft_id, completed: detail.status === 'complete', slotToRoster: detail.slot_to_roster_id ?? {}, picks: picks.map(p => ({ playerId: p.player_id, name: [p.metadata?.first_name, p.metadata?.last_name].filter(Boolean).join(' ') || `Sleeper player ${p.player_id}`, position: p.metadata?.position ?? 'UNK', round: p.round, slot: p.draft_slot, overall: p.pick_no, rosterId: Number(p.roster_id) })) });
      }
      season.complete = true;
    } catch (error) { season.error = error instanceof Error ? error.message : 'History source unavailable'; }
    seasons.push(season);
    id = league.previous_league_id || null;
  }
  // Download the public catalog once, then retain only names needed by this ledger.
  const catalog = await json<Record<string, { full_name?: string; first_name?: string; last_name?: string; position?: string }>>('players/nfl');
  const needed = new Set(seasons.flatMap(s => [...s.trades.flatMap(t => [...Object.keys(t.adds ?? {}), ...Object.keys(t.drops ?? {})]), ...s.drafts.flatMap(d => d.picks.map(p => p.playerId))]));
  for (const pid of needed) {
    const p = catalog[pid];
    players[pid] = { name: p?.full_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || `Sleeper player ${pid}`, position: p?.position ?? 'UNK' };
  }
  return { rootLeagueId, checkedAt: new Date().toISOString(), chainComplete: id === null && seasons.every(s => s.complete), seasons, players };
}
