import { readFile, writeFile } from 'node:fs/promises';
import historyJson from '../src/data/league-history.json';
import type { LeagueHistory } from '../src/lib/leagueHistorySource';
import type { RecoveredTradePrices, DailyTradePrice } from '../src/lib/historicalKtc';
import { canonicalKtcMatchName } from '../src/lib/ktcIdentityOverrides';
async function main() {
  const history = historyJson as unknown as LeagueHistory;
  const rows: (string | number | null)[][] = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const names = rows[0];
  if (names[1] !== 'Date' || !names.includes('2024 Early 1st')) throw new Error('Unexpected SF archive schema');
  const dates = new Map(rows.slice(2).map(row => [String(row[1]).slice(0,10),row]));
  const recovered: RecoveredTradePrices = JSON.parse(await readFile('src/data/trade-chart-prices.json','utf8'));
  const source = 'https://docs.google.com/spreadsheets/d/1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs/edit';
  const aliases: Record<string,string> = {'5284':'Jeffery Wilson','6943':'Gabriel Davis','5347':'Nyheim Hines'};
  let players = 0, picks = 0;
  for (const trade of history.seasons.flatMap(s=>s.trades)) {
    const date = new Date(trade.created - 86400000).toISOString().slice(0,10), row = dates.get(date);
    if (!row) continue;
    const prices = recovered.prices[trade.transaction_id] ??= {};
    const quote = (value:number, method:DailyTradePrice['method']):DailyTradePrice => ({value,date,method,sourceUrls:[source]});
    for (const id of Object.keys(trade.adds ?? {})) {
      if (prices['player:'+id]) continue;
      const name = aliases[id] ?? history.players[id]?.name;
      const columns = names.flatMap((n,i)=>typeof n==='string' && canonicalKtcMatchName(n)===canonicalKtcMatchName(name) ? [i] : []);
      if (columns.length !== 1) continue;
      const value = row[columns[0]];
      if (typeof value === 'number' && value>0 && value<=9999) { prices['player:'+id]=quote(value,'ARCHIVED_KTC_PLAYER');players++; }
    }
    for (const pick of trade.draft_picks as {season:string;round:number;roster_id:number}[]) {
      const key = `pick:${pick.season}:${pick.round}:${pick.roster_id}`;
      if (prices[key]) continue;
      const ordinal = ['','1st','2nd','3rd','4th'][pick.round];
      if (!ordinal) continue;
      const values = ['Early','Mid','Late'].map(bucket => {const index=names.indexOf(`${pick.season} ${bucket} ${ordinal}`);return index<0?null:row[index];});
      if (!values.every((v):v is number=>typeof v==='number'&&v>0&&v<=9999)) continue;
      prices[key]=quote(Math.round(values.reduce((a,b)=>a+b,0)/3),'ARCHIVED_KTC_ROUND_AVERAGE');picks++;
    }
    if (!Object.keys(prices).length) delete recovered.prices[trade.transaction_id];
  }
  recovered.fetchedAt = new Date().toISOString();
  await writeFile('src/data/trade-chart-prices.json',JSON.stringify(recovered));
  console.log(JSON.stringify({addedPlayers:players,addedPicks:picks,tradesWithPrices:Object.keys(recovered.prices).length}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
