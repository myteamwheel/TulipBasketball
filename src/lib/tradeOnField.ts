export type MatchupWeek = { season: string; leagueId: string; week: number; start: number; rows: { roster_id: number; matchup_id: number | null; points: number | null; custom_points: number | null; players: string[] | null; starters: string[] | null; starters_points: number[] | null }[] };
export type OnFieldContribution = { starts: number; points: number; wins: number; losses: number; ties: number; firstWeek: number; lastWeek: number };
/** Counts completed lineups only while each acquired player remained rostered in the trade season. */
export function tradeOnField(weeks: MatchupWeek[], leagueId: string, tradeAt: number, rosterId: number, acquired: string[]): OnFieldContribution | null {
  const relevant = weeks.filter(week => week.leagueId === leagueId && week.start > tradeAt).sort((a,b) => a.start-b.start);
  if (!relevant.length || !acquired.length) return null;
  const active = new Set(acquired);
  let starts=0, points=0, wins=0, losses=0, ties=0;
  let firstWeek=0, lastWeek=0;
  for (const week of relevant) {
    const team=week.rows.find(row => row.roster_id===rosterId);
    if (!team || !Array.isArray(team.players) || !Array.isArray(team.starters) || !Array.isArray(team.starters_points) || team.starters.length !== team.starters_points.length) break;
    for (const id of active) if (!team.players.includes(id)) active.delete(id);
    const indices=team.starters.flatMap((id,index)=>active.has(id) ? [index] : []);
    if (!indices.length) continue;
    const values=indices.map(index=>team.starters_points![index]);
    if (values.some(value=>typeof value !== 'number' || !Number.isFinite(value))) continue;
    const opponents=week.rows.filter(row => row.matchup_id !== null && row.matchup_id===team.matchup_id && row.roster_id!==rosterId);
    const teamPoints=team.custom_points ?? team.points, opponentPoints=opponents[0]?.custom_points ?? opponents[0]?.points;
    if (opponents.length!==1 || teamPoints == null || opponentPoints == null || !Number.isFinite(teamPoints) || !Number.isFinite(opponentPoints)) continue;
    starts+=indices.length;points+=values.reduce((sum,value)=>sum+value,0);
    if (teamPoints>opponentPoints) wins++; else if (teamPoints<opponentPoints) losses++; else ties++;
    if (!firstWeek) firstWeek=week.week;lastWeek=week.week;
  }
  return starts ? {starts,points:Math.round(points*100)/100,wins,losses,ties,firstWeek,lastWeek} : null;
}
