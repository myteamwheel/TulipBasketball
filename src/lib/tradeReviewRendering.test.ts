import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TradeReviewCard, { type ReviewAsset } from '../components/TradeReviewCard';
import TradeReviewBoard from '../components/TradeReviewBoard';
import { calculateTradeSideGrades } from './tradeGrades';
const asset = (id: string, value: number | null): ReviewAsset => ({id,label:id,playerId:null,assetType:'player',atTradeValue:value,currentValue:value,atMoveObservedAt:null,atMoveTiming:null});
function sides(missing=false) {
 const a=[asset('Player A',5000)], b=[asset('Player B',missing?null:3000)];
 return [{rosterId:1,name:'Team One',gave:b,got:a,grades:calculateTradeSideGrades({gave:b,got:a})},{rosterId:2,name:'Team Two',gave:a,got:b,grades:calculateTradeSideGrades({gave:a,got:b})}];
}
test('trade reviewer identifies the winning recipient and renders both received packages',()=>{
 const html=renderToStaticMarkup(React.createElement(TradeReviewCard,{sides:sides()}));
 assert.match(html,/<strong>Team One<\/strong>/);
 assert.match(html,/Team Two/);
 assert.match(html,/Player A/);
 assert.match(html,/Player B/);
 assert.doesNotMatch(html,/<section class="trade-packages"/);
 assert.match(html,/trade-inline-prices/);
 assert.match(html,/At trade/);
 assert.match(html,/Now/);
 assert.match(html,/Replay change from trade date to now/);
});
test('trade history renders complete review cards without an expansion step',()=>{
 const html=renderToStaticMarkup(React.createElement(TradeReviewBoard,{trades:[{id:'one',date:'2026-10-31T12:00:00.000Z',sides:sides()}]}));
 assert.match(html,/trade-result-detail/);
 assert.match(html,/trade-inline-prices/);
 assert.match(html,/Player A/);
 assert.doesNotMatch(html,/trade-result-chevron|aria-expanded="false"/);
});
test('main comparison lists every received asset and FAAB without a shortened preview',()=>{
 const received=[asset('First player (QB)',5000),asset('Second player (RB)',3000),asset('Third player (WR)',2000),{...asset('2028 Round 1 · Original Team With A Long Name',4000),assetType:'pick' as const}];
 const sent=[asset('Outgoing player (TE)',6000)];
 const rows=[
  {rosterId:1,name:'Receiving team',got:received,gave:sent,faabReceived:17,grades:calculateTradeSideGrades({got:received,gave:sent,faabReceived:17})},
  {rosterId:2,name:'Other team',got:sent,gave:received,faabSent:17,grades:calculateTradeSideGrades({got:sent,gave:received,faabSent:17})},
 ];
 const html=renderToStaticMarkup(React.createElement(TradeReviewCard,{sides:rows}));
 const matrix=html.slice(html.indexOf('class="trade-matrix"'),html.indexOf('class="trade-change-line'));
 for(const item of [...received,...sent]) assert.ok(matrix.includes(item.label),`Missing ${item.label} from main comparison`);
 assert.match(matrix,/\$17.*FAAB/);
 assert.match(matrix,/aria-label="Receiving team received"/);
 assert.doesNotMatch(matrix,/\+\d+ more|<details|<summary/);
});
test('incomplete trade reviewer withholds a winner instead of grading the known subset',()=>{
 const html=renderToStaticMarkup(React.createElement(TradeReviewCard,{sides:sides(true)}));
 assert.match(html,/<strong>Unavailable<\/strong>/);
 assert.match(html,/At-trade prices missing/);
 assert.doesNotMatch(html,/<strong>Team One<\/strong><\/div><span class="trade-winner-arrow"/);
});
test('player-for-FAAB reviewer shows a market edge and displays FAAB outside the rating',()=>{
 const player=[asset('Reggie Virgil',805)];
 const rows=[
  {rosterId:7,name:'Buyer',gave:[],got:player,faabSent:9,faabReceived:0,grades:calculateTradeSideGrades({gave:[],got:player,faabSent:9})},
  {rosterId:3,name:'Seller',gave:player,got:[],faabSent:0,faabReceived:9,grades:calculateTradeSideGrades({gave:player,got:[],faabReceived:9})},
 ];
 const html=renderToStaticMarkup(React.createElement(TradeReviewCard,{sides:rows}));
 assert.match(html,/<strong>Buyer<\/strong>/);
 assert.match(html,/FAAB received \$9/);
 assert.match(html,/sent \$9/);
 assert.match(html,/FAAB recorded · excluded from grades/);
 assert.match(html,/Advantage change for Buyer/);
 assert.doesNotMatch(html,/At-trade prices missing|Current prices missing/);
});
test('FAAB-only transfers are not labeled incomplete',()=>{
 const rows=[1,2].map(rosterId=>({rosterId,name:`Team ${rosterId}`,gave:[],got:[],faabSent:rosterId===1?9:0,faabReceived:rosterId===2?9:0,grades:calculateTradeSideGrades({gave:[],got:[],faabSent:rosterId===1?9:0,faabReceived:rosterId===2?9:0})}));
 const html=renderToStaticMarkup(React.createElement(TradeReviewCard,{sides:rows}));
 assert.match(html,/FAAB only/);
 assert.doesNotMatch(html,/At-trade prices missing|Current prices missing/);
});
test('an absent historical price does not claim the current grade was excluded',()=>{
 const rows=sides();
 rows[0].got[0].atTradeValue=null;
 for(const side of rows) side.grades=calculateTradeSideGrades(side);
 const html=renderToStaticMarkup(React.createElement(TradeReviewCard,{sides:rows}));
 assert.match(html,/<strong>Team One<\/strong>/);
 assert.match(html,/At-trade prices missing/);
 assert.doesNotMatch(html,/excluded from grades/);
});
test('used picks and estimated zeroes appear in the main current comparison',()=>{
 const picked={...asset('2024 Round 1',2500),assetType:'pick' as const,currentValue:null,outcome:{label:'Selected Player',playerId:null,sleeperId:'999',pickNumber:4,currentValue:0,currentValueIsUnranked:true,sourceUrl:'https://sleeper.com'}};
 const acquired={...asset('Active Player',4000),currentValue:3000};
 const rows=[{rosterId:1,name:'Team One',got:[acquired],gave:[picked],grades:calculateTradeSideGrades({got:[acquired],gave:[picked]})},{rosterId:2,name:'Team Two',got:[picked],gave:[acquired],grades:calculateTradeSideGrades({got:[picked],gave:[acquired]})}];
 const trade={id:'one',date:'2026-11-04T12:00:00Z',sides:rows,currentValueSource:'STATSGUY' as const};
 const html=renderToStaticMarkup(React.createElement(TradeReviewCard,{sides:rows,trade}));
 const matrix=html.slice(html.indexOf('class="trade-matrix"'),html.indexOf('class="trade-change-line'));
 assert.match(matrix,/Selected Player/);
 assert.match(matrix,/unranked · estimated 0/);
 assert.match(matrix,/<strong>A\+<\/strong>/);
 assert.match(html,/Now:.*Stats Guy Fantasy/);
 assert.doesNotMatch(html,/Advantage change for/);
});
test('Excel export round-trip remains compatible with the UUID override',async()=>{
 const ExcelJS=await import('exceljs');
 const book=new ExcelJS.default.Workbook();
 const sheet=book.addWorksheet('Audit');
 sheet.addRow(['Team','Value']);sheet.addRow(['Orlando Oswalds',5000]);
 sheet.addConditionalFormatting({ref:'B2',rules:[{type:'dataBar',priority:1,minLength:0,maxLength:100,cfvo:[{type:'min'},{type:'max'}]}]});
 const bytes=await book.xlsx.writeBuffer();
 const restored=new ExcelJS.default.Workbook();
 await restored.xlsx.load(bytes);
 assert.equal(restored.worksheets[0].getCell('B2').value,5000);
});
