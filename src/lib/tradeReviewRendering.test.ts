import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TradeReviewCard, { type ReviewAsset } from '../components/TradeReviewCard';
import { calculateTradeSideGrades } from './tradeGrades';
const asset = (id: string, value: number | null): ReviewAsset => ({id,label:id,playerId:null,assetType:'player',atTradeValue:value,currentValue:value,atMoveObservedAt:null,atMoveTiming:null});
function sides(missing=false) {
 const a=[asset('Player A',5000)], b=[asset('Player B',missing?null:3000)];
 return [{rosterId:1,name:'Team One',gave:b,got:a,grades:calculateTradeSideGrades({gave:b,got:a})},{rosterId:2,name:'Team Two',gave:a,got:b,grades:calculateTradeSideGrades({gave:a,got:b})}];
}
test('trade reviewer identifies the winning recipient and renders both received packages',()=>{
 const html=renderToStaticMarkup(React.createElement(TradeReviewCard,{sides:sides()}));
 assert.match(html,/Team One has the market edge/);
 assert.match(html,/Team Two/);
 assert.match(html,/Player A/);
 assert.match(html,/Player B/);
 assert.match(html,/aria-pressed="true"/);
 assert.match(html,/Replay comparison/);
});
test('incomplete trade reviewer withholds a winner instead of grading the known subset',()=>{
 const html=renderToStaticMarkup(React.createElement(TradeReviewCard,{sides:sides(true)}));
 assert.match(html,/Winner withheld/);
 assert.doesNotMatch(html,/has the market edge/);
 assert.match(html,/Missing price/);
});
test('player-for-FAAB reviewer shows a market edge and displays FAAB outside the rating',()=>{
 const player=[asset('Reggie Virgil',805)];
 const rows=[
  {rosterId:7,name:'Buyer',gave:[],got:player,faabSent:9,faabReceived:0,grades:calculateTradeSideGrades({gave:[],got:player,faabSent:9})},
  {rosterId:3,name:'Seller',gave:player,got:[],faabSent:0,faabReceived:9,grades:calculateTradeSideGrades({gave:player,got:[],faabReceived:9})},
 ];
 const html=renderToStaticMarkup(React.createElement(TradeReviewCard,{sides:rows}));
 assert.match(html,/Buyer has the market edge/);
 assert.match(html,/FAAB sent: \$9/);
 assert.match(html,/FAAB received: \$9/);
 assert.match(html,/counts as 0 in both historical and current ratings/);
 assert.doesNotMatch(html,/Winner withheld|Grade unavailable/);
});
test('FAAB-only transfers are not labeled incomplete',()=>{
 const rows=[1,2].map(rosterId=>({rosterId,name:`Team ${rosterId}`,gave:[],got:[],faabSent:rosterId===1?9:0,faabReceived:rosterId===2?9:0,grades:calculateTradeSideGrades({gave:[],got:[],faabSent:rosterId===1?9:0,faabReceived:rosterId===2?9:0})}));
 const html=renderToStaticMarkup(React.createElement(TradeReviewCard,{sides:rows}));
 assert.match(html,/FAAB-only transfer/);
 assert.doesNotMatch(html,/Winner withheld|Grade unavailable/);
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
