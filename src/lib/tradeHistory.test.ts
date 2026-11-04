import test from 'node:test';
import assert from 'node:assert/strict';
import historyJson from '../data/league-history.json';
import type { LeagueHistory } from './leagueHistorySource';
import { historicalManager, resolveDraftPick } from './tradeLineage';
import { integrityAlerts, tradeTransferIsValid } from './dataIntegrity';
import { exportGradeColor, wrapExportText } from './tradeImage';
import { calculateTradeSideGrades } from './tradeGrades';
import { rankTrades, type ReviewAsset, type ReviewSide } from './tradeReview';
const history = historyJson as unknown as LeagueHistory;
test('bundled history is a complete linked chain with unique complete trades and preserved identifiers', () => {
  assert.equal(history.chainComplete, true);
  assert.ok(history.seasons.length >= 6);
  const ids = new Set<string>();
  history.seasons.forEach((season, index) => {
    assert.equal(season.complete, true);
    assert.equal(season.previousLeagueId || null, history.seasons[index+1]?.leagueId ?? null);
    for (const trade of season.trades) {
      assert.equal(typeof trade.transaction_id, 'string');
      assert.equal(trade.status, 'complete');
      assert.ok(!ids.has(trade.transaction_id)); ids.add(trade.transaction_id);
      assert.equal(tradeTransferIsValid(trade), true, trade.transaction_id);
    }
  });
});
test('manager identity follows owners rather than recycled roster slots', () => {
  const sample = { ...history, seasons: history.seasons.slice(0,2).map((s,i) => ({...s, managers:[{rosterId:1,ownerId:i ? 'former-owner' : 'new-owner',name:'Same name'}]})) };
  assert.notEqual(historicalManager(sample, sample.seasons[0].leagueId,1).key,historicalManager(sample, sample.seasons[1].leagueId,1).key);
});
test('pick resolution uses original draft slot and rejects ambiguous mappings', () => {
  const season=history.seasons.find(s=>s.season==='2025')!;
  const draft=season.drafts[0], pick=draft.picks[0], original=Number(draft.slotToRoster[String(pick.slot)]);
  assert.equal(resolveDraftPick(history,season.season,pick.round,original)?.playerId,pick.playerId);
  assert.equal(resolveDraftPick({...history,seasons:[{...season,drafts:[draft,draft]}]},season.season,pick.round,original),null);
});
test('integrity rejects orphan and self-transferred assets, without requiring FAAB market prices', () => {
  const base={adds:{p:1},drops:{p:2},draft_picks:[],waiver_budget:[],roster_ids:[1,2]};
  assert.equal(tradeTransferIsValid(base),true);
  assert.equal(tradeTransferIsValid({...base,drops:null}),false);
  assert.equal(tradeTransferIsValid({...base,drops:{p:1}}),false);
  assert.equal(tradeTransferIsValid({...base,adds:{},drops:{},waiver_budget:[{sender:2,receiver:1,amount:5}]}),true);
});
test('integrity flags coverage collapse, overdue sync, duplicates and incomplete trades', () => {
  const alerts=integrityAlerts({now:Date.now(),lastSync:null,currentCoverage:40,priorCoverage:300,duplicatePlayers:1,invalidTrades:1});
  assert.deepEqual(alerts.map(a=>a.code),['STALE_SYNC','COVERAGE_DROP','DUPLICATE_OWNERSHIP','INCOMPLETE_TRADE']);
});
const asset=(id:string,value:number):ReviewAsset=>({id,label:id,playerId:null,assetType:'player',atTradeValue:value,currentValue:value,atMoveObservedAt:null,atMoveTiming:null});
test('image grades use outcome colors and wrap long labels without truncation',()=>{
  const side:ReviewSide={rosterId:1,name:'Test',gave:[asset('A',9000)],got:[asset('B',1000)],grades:null};side.grades=calculateTradeSideGrades(side);
  assert.equal(exportGradeColor(side,'current'),'#fda4af');
  const text='2027 First Round Original Owner With A Very Long Team Name';
  const lines=wrapExportText(text,18,s=>s.length);
  assert.ok(lines.every(line=>line.length<=18));assert.equal(lines.join(' '),text);
});
test('drafted-player rankings preserve original-asset grades and exclude later returns',()=>{
  const pick={...asset('2025 First',4000),assetType:'pick' as const,currentValue:null,outcome:{label:'Player',playerId:null,sleeperId:'p',pickNumber:1,currentValue:8000,sourceUrl:'https://sleeper.com'}};
  const other=asset('Original player',3000);
  const side={rosterId:1,name:'Test',gave:[other],got:[pick],grades:calculateTradeSideGrades({gave:[other],got:[pick]})};
  assert.equal(side.grades.current.status,'INCOMPLETE');
  const results=rankTrades([{id:'one',date:'2025-03-01',sides:[side]}],'outcomeNow','points',{team:null,opponent:null,season:'all',asset:'all',faab:'all'});
  assert.equal(results.length,1);assert.equal(results[0].score,5000);
  assert.equal(side.grades.current.status,'INCOMPLETE');
});

test('daily historical fallback uses only the prior date and never the trade day or current quote', async () => {
  const { priorDayPrice } = await import('./historicalKtc');
  const rows = [{d:'210505',v:4000},{d:'210506',v:9000},{d:'261103',v:8000}];
  const price = priorDayPrice(rows, Date.parse('2021-05-06T12:00:00Z'), ['https://keeptradecut.com']);
  assert.equal(price?.value,4000); assert.equal(price?.date,'2021-05-05');
  assert.equal(priorDayPrice(rows,Date.parse('2021-05-09T12:00:00Z'),[]),null);
});

test('recovered historical prices have unique identities, valid prior dates and official source links', async () => {
  const { default: recovered } = await import('../data/trade-chart-prices.json');
  const tradeById = new Map(history.seasons.flatMap(s => s.trades).map(t => [t.transaction_id,t]));
  for (const [id,prices] of Object.entries(recovered.prices)) {
    const trade = tradeById.get(id); assert.ok(trade, id);
    for (const [asset,price] of Object.entries(prices)) {
      if (asset.startsWith('player:')) assert.ok(Object.hasOwn(trade.adds ?? {}, asset.slice(7)), asset);
      else assert.ok((trade.draft_picks as {season:string;round:number;roster_id:number}[]).some(p=>asset===`pick:${p.season}:${p.round}:${p.roster_id}`),asset);
      assert.equal(price.date,new Date(trade.created-86400000).toISOString().slice(0,10));
      assert.ok(price.value>0 && price.value<=9999);
      assert.ok(price.sourceUrls.every(url=>url.startsWith('https://keeptradecut.com/dynasty-rankings/players/') || url === 'https://docs.google.com/spreadsheets/d/1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs/edit' || url === 'https://github.com/G-Sher/dynasty-daddy/blob/main/data/datasource.csv'));
      if (price.method === 'KTC_ROUND_AVERAGE') assert.equal(price.sourceUrls.length,3);
    }
  }
});
