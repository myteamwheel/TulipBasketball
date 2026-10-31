import test from 'node:test';
import assert from 'node:assert/strict';
import { freshPickRows, historicalPickSnapshots } from './pickFreshness';
import type { DraftPickMarketValue } from './marketSources';
const now = new Date('2026-10-28T20:00:00Z').getTime();
const row = (date: string | null): DraftPickMarketValue => ({ key:'2027-1',season:'2027',round:1,slot:null,label:'2027 Round 1',value:4000,source:'DYNASTY_DEALER',sourceUpdatedAt:date });
test('fresh pick rows exclude stale, future, missing and invalid observations',()=>{
 const good=row('2026-10-28T19:00:00Z');
 assert.deepEqual(freshPickRows([good,row('2026-10-20T20:00:00Z'),row(null),row('2026-10-29T20:00:00Z'),{...good,value:NaN}],now),[good]);
});
test('historical pick evidence uses provider time instead of refresh completion',()=>{
 const snapshots=historicalPickSnapshots([{summary:JSON.stringify({draftPickMarket:{rows:[row('2026-10-20T20:00:00Z')]}})}]);
 assert.equal(snapshots[0].observedAt.toISOString(),'2026-10-20T20:00:00.000Z');
 assert.deepEqual(historicalPickSnapshots([{summary:JSON.stringify({draftPickMarket:{rows:[row(null)]}})}]),[]);
});
test('generic early, mid and late pick rows survive snapshot grouping',()=>{
 const base=row('2026-10-28T19:00:00Z');
 const rows=['Early','Mid','Late'].map((label,index)=>({...base,label:label+' 2027 Round 1',value:5000-index*1000}));
 assert.equal(historicalPickSnapshots([{summary:JSON.stringify({draftPickMarket:{rows}})}])[0].rows.length,3);
});
