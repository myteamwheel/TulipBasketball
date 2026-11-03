type Player = { id: string; fullName: string; position: string; nflTeam: string | null };
type Row = { playerId: string };
type Result = Row & { season: number; week: number; actualFantasyPoints: number | null };

/** Keep missing refresh records visible without counting them as model evidence. */
export function pendingProjectionPlayers(
  players: Player[], current: Row[], unavailable: Row[], history: Result[], season: number, week: number,
) {
  const accounted = new Set([
    ...current.map(row => row.playerId),
    ...unavailable.map(row => row.playerId),
    ...history.filter(row => row.season === season && row.week === week && row.actualFantasyPoints !== null).map(row => row.playerId),
  ]);
  return players.filter(player => !accounted.has(player.id));
}
