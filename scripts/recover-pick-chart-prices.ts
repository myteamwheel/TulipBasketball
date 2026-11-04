import { readFile, writeFile } from 'node:fs/promises';
import historyJson from '../src/data/league-history.json';
import type { LeagueHistory } from '../src/lib/leagueHistorySource';
import { parseKtcDailyHistory, priorDayPrice, type RecoveredTradePrices } from '../src/lib/historicalKtc';
async function main() {
  const history = historyJson as unknown as LeagueHistory;
  const catalog: {playerID:number;playerName:string;slug:string;position:string}[] = JSON.parse(await readFile(process.argv[2],'utf8'));
  const jobs = catalog.filter(p=>p.position==='RDP');
  const series = new Map<string,{rows:{d:string;v:number}[];url:string}>();
  let next=0;
  async function worker() {
    while(next<jobs.length) {
      const p=jobs[next++],url='https://keeptradecut.com/dynasty-rankings/players/'+p.slug;
      const r=await fetch(url,{signal:AbortSignal.timeout(30000)});
      if(!r.ok)throw new Error(`${p.playerName}: HTTP ${r.status}`);
      series.set(p.playerName,{rows:parseKtcDailyHistory(await r.text(),p.playerID),url});
      console.log('Loaded '+p.playerName);
    }
  }
  await Promise.all([worker(),worker()]);
  const result:RecoveredTradePrices=JSON.parse(await readFile('src/data/trade-chart-prices.json','utf8'));
  let added=0;
  for(const trade of history.seasons.flatMap(s=>s.trades)) for(const p of trade.draft_picks as {season:string;round:number;roster_id:number}[]) {
    const key=`pick:${p.season}:${p.round}:${p.roster_id}`;
    if(result.prices[trade.transaction_id]?.[key])continue;
    const ordinal=['','1st','2nd','3rd','4th'][p.round];
    const quotes=['Early','Mid','Late'].map(bucket=>{const s=series.get(`${p.season} ${bucket} ${ordinal}`);return s?priorDayPrice(s.rows,trade.created,[s.url]):null;});
    if(quotes.some(q=>!q))continue;
    const valid=quotes.filter(q=>q!==null);
    (result.prices[trade.transaction_id]??={})[key]={value:Math.round(valid.reduce((n,q)=>n+q.value,0)/3),date:valid[0].date,method:'KTC_ROUND_AVERAGE',sourceUrls:valid.flatMap(q=>q.sourceUrls)};added++;
  }
  result.fetchedAt=new Date().toISOString();
  await writeFile('src/data/trade-chart-prices.json',JSON.stringify(result));
  console.log(JSON.stringify({addedPickPrices:added}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
