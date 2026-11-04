import { writeFile } from 'node:fs/promises';
import historyJson from '../src/data/league-history.json';
import type { LeagueHistory } from '../src/lib/leagueHistorySource';
const history = historyJson as unknown as LeagueHistory;
import { canonicalKtcMatchName } from '../src/lib/ktcIdentityOverrides';
import { parseKtcDailyHistory, priorDayPrice, type RecoveredTradePrices } from '../src/lib/historicalKtc';
type CatalogPlayer = { playerID: number; playerName: string; slug: string; position: string };
async function main() {
const boardResponse = await fetch('https://keeptradecut.com/dynasty-rankings', {signal: AbortSignal.timeout(30000)});
if (!boardResponse.ok) throw new Error('KTC catalog unavailable');
const board = await boardResponse.text();
const catalogJson = board.match(/<script[^>]+id="ktc-players"[^>]*>([\s\S]*?)<\/script>/)?.[1];
if (!catalogJson) throw new Error('KTC catalog absent');
const catalog: CatalogPlayer[] = JSON.parse(catalogJson);
const trades = history.seasons.flatMap(s => s.trades);
const needed = [...new Set(trades.flatMap(t => Object.keys(t.adds ?? {})))];
const sourcePlayers = history.players as Record<string, {name: string; position: string}>;
const result: RecoveredTradePrices = { fetchedAt: new Date().toISOString(), prices: {}, matchedPlayers: 0, missingPlayers: [], failures: [] };
const jobs = needed.flatMap(id => {
  const source = sourcePlayers[id];
  const matches = catalog.filter(p => p.position === source.position && canonicalKtcMatchName(p.playerName) === canonicalKtcMatchName(source.name));
  if (matches.length !== 1) { result.missingPlayers.push(source.name); return []; }
  return [{id, player: matches[0]}];
});
let next = 0, done = 0;
async function worker() {
  while (next < jobs.length) {
    const {id, player} = jobs[next++];
    const url = 'https://keeptradecut.com/dynasty-rankings/players/' + player.slug;
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const rows = parseKtcDailyHistory(await response.text(), player.playerID);
      for (const trade of trades.filter(t => Object.hasOwn(t.adds ?? {}, id))) {
        const quote = priorDayPrice(rows, trade.created, [url]);
        if (quote) (result.prices[trade.transaction_id] ??= {})['player:' + id] = quote;
      }
      result.matchedPlayers++;
    } catch (error) { result.failures.push(player.playerName + ': ' + String(error)); }
    done++;
    if (done % 20 === 0) console.log(`${done}/${jobs.length} pages; ${Object.keys(result.prices).length} trades with recovered prices`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}
console.log(`${jobs.length} unambiguous player identities; ${result.missingPlayers.length} require another source`);
await Promise.all([worker(),worker()]);
await writeFile('src/data/trade-chart-prices.json', JSON.stringify(result));
console.log(JSON.stringify({players:result.matchedPlayers,trades:Object.keys(result.prices).length,prices:Object.values(result.prices).reduce((n,p)=>n+Object.keys(p).length,0),failures:result.failures}));

}
main().catch(error => { console.error(error); process.exitCode = 1; });
