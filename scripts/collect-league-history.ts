import { writeFile } from 'node:fs/promises';
import { fetchLeagueHistory } from '../src/lib/leagueHistorySource';
import { SLEEPER_LEAGUE_ID } from '../src/lib/config';
async function main() {
  const data = await fetchLeagueHistory(SLEEPER_LEAGUE_ID);
  if (!data.chainComplete) throw new Error('History collection incomplete; existing snapshot preserved.');
  await writeFile('src/data/league-history.json', JSON.stringify(data));
  console.log(JSON.stringify({ complete: data.chainComplete, seasons: data.seasons.map(s => ({ season: s.season, trades: s.trades.length, drafts: s.drafts.length })), players: Object.keys(data.players).length }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
