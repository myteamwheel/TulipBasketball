"use client";
import Link from "next/link";
import React, { useState } from "react";
import { formatDateTimeEastern, formatPoints, formatSigned, formatPercent } from "@/lib/format";
import type { TradeGradeAsset, TradeGradePhase, TradeSnapshotTiming } from "@/lib/tradeGrades";
export type ReviewAsset = TradeGradeAsset & { playerId: string | null; atMoveObservedAt: string | null; atMoveTiming: TradeSnapshotTiming | null };
type Side = { rosterId: number; name: string; gave: ReviewAsset[]; got: ReviewAsset[]; faabSent?: number; faabReceived?: number; grades: { atTrade: TradeGradePhase; current: TradeGradePhase } | null };
export default function TradeReviewCard({ sides }: { sides: Side[] }) {
 const [phase, setPhase] = useState<'atTrade' | 'current'>('current');
 const [replay, setReplay] = useState(0);
 const ratedSides = sides.filter(s => s.grades?.[phase].status !== 'EXCLUDED');
 const faabOnly = sides.length > 0 && ratedSides.length === 0;
 const ready = sides.length >= 2 && ratedSides.length > 0 && ratedSides.every(s => s.grades?.[phase].status === 'READY');
 const winners = ready ? ratedSides.filter(s => s.grades?.[phase].result === 'WON') : [];
 const hasFaab = sides.some(s => (s.faabSent ?? 0) > 0 || (s.faabReceived ?? 0) > 0);
 const approximation = phase === 'atTrade' && sides.some(s => [...s.gave,...s.got].some(a => a.atMoveTiming === 'NEXT_DAY_APPROXIMATION'));
 const maxValue = Math.max(1,...sides.map(s => s.grades?.[phase].balance?.get.adjustedValue ?? 0));
 return <section className="trade-review space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="flex rounded-lg border border-slate-300 bg-slate-100 p-1" role="group" aria-label="Compare trade valuations">
    {([['atTrade','At trade'],['current','Now']] as const).map(([key,text]) => <button key={key} type="button" aria-pressed={phase===key} onClick={()=>setPhase(key)} className={`min-h-11 rounded-md px-4 text-sm font-medium ${phase===key?'bg-emerald-700 text-white shadow-sm':'text-slate-700'}`}>{text}</button>)}
   </div>
   <button type="button" onClick={()=>setReplay(value=>value+1)} className="min-h-11 rounded-md px-3 text-xs font-medium text-emerald-800 hover:bg-emerald-50">Replay comparison</button>
  </div>
  <div className={`rounded-xl border p-4 ${ready?'border-emerald-200 bg-emerald-50':'border-amber-200 bg-amber-50'}`} aria-live="polite">
   <p className="text-xs font-semibold uppercase tracking-wider text-slate-700">{phase==='current'?'Today’s market':'At the trade'}{approximation?' · approximate snapshot':''}</p>
   <h2 className="mt-1 text-lg font-semibold text-slate-950">{faabOnly?'FAAB-only transfer — no players or picks to rate':!ready?'Winner withheld — missing player, pick, or ledger data':winners.length===1?`${winners[0].name} has the market edge`:winners.length>1?'Multiple teams gained market value':'An even market exchange'}</h2>
   <p className="mt-1 text-sm text-slate-600">{faabOnly?'The transfer is recorded below. No market grade is needed.':!ready?'A player or pick price, or a recorded trade side, is missing. See the reason below each team.':'The original player and pick packages are compared using market values. Grades measure market value; team fit and fantasy points can differ.'}</p>
   {hasFaab?<p className="mt-2 text-sm font-medium text-slate-700">FAAB is shown for the record and counts as 0 in both historical and current ratings. A player-for-FAAB deal therefore favors the player recipient in this model.</p>:null}
  </div>
  <div className="grid gap-4 lg:grid-cols-2">{sides.map(side=>{
   const grade=side.grades?.[phase], balance=grade?.balance, winning=grade?.result==='WON';
   return <section key={side.rosterId} className={`min-w-0 rounded-xl border p-4 ${winning?'border-emerald-300 bg-white':'border-slate-200 bg-slate-50'}`}>
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Received by</p><h3 className="mt-1 text-base font-semibold text-slate-950">{side.name}</h3></div><span className={`rounded-lg px-3 py-2 text-lg font-bold ${winning?'bg-emerald-100 text-emerald-900':'bg-slate-200 text-slate-800'}`}>{grade?.grade??'—'}</span></div>
    {balance?<div className="my-4">
     <div className="flex justify-between gap-2 text-sm"><span>Adjusted package</span><strong>{formatPoints(balance.get.adjustedValue)}</strong></div>
     <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true"><div key={`${phase}:${replay}`} className="trade-value-bar h-full rounded-full bg-emerald-600" style={{width:`${balance.get.adjustedValue/maxValue*100}%`}}/></div>
     <p className="mt-2 text-sm font-semibold text-slate-800">{grade?.result==='EVEN'?'Even (within 3%)':winning?'Market win':'Market loss'} · {formatSigned(balance.adjustedEdge)} · {formatPercent(balance.edgePercent)}</p>
     <p className="mt-1 text-xs text-slate-500">Sent {formatPoints(balance.give.adjustedValue)} adjusted · received {formatPoints(balance.get.rawValue)} before the package discount.</p>
    </div>:<p className="my-3 text-sm text-amber-800">{grade?.status==='EXCLUDED'?'No market grade.':'Grade unavailable.'} {grade?.reason}</p>}
    {(side.faabReceived ?? 0)>0 || (side.faabSent ?? 0)>0?<p className="my-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">FAAB{(side.faabReceived ?? 0)>0?` received: $${side.faabReceived}`:''}{(side.faabReceived ?? 0)>0 && (side.faabSent ?? 0)>0?' · ':''}{(side.faabSent ?? 0)>0?` sent: $${side.faabSent}`:''} · excluded from rating</p>:null}
    <ul className="divide-y divide-slate-200">{side.got.map(asset=><li key={asset.id} className="py-3">
     <div className="flex items-start justify-between gap-3"><span className="text-sm font-medium text-slate-900">{asset.playerId?<Link className="underline decoration-slate-300 underline-offset-4 hover:text-emerald-800" href={`/players/${asset.playerId}`}>{asset.label}</Link>:asset.label}</span><strong className="shrink-0 text-sm tabular-nums">{formatPoints(phase==='current'?asset.currentValue:asset.atTradeValue)}</strong></div>
     <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600"><span>At trade {formatPoints(asset.atTradeValue)}</span><span>Now {formatPoints(asset.currentValue)}</span>{asset.atTradeValue!==null&&asset.currentValue!==null?<span>{formatSigned(asset.currentValue-asset.atTradeValue)} since trade</span>:<span>Missing price; excluded from grades</span>}</div>
     {asset.atMoveObservedAt?<p className="mt-1 text-xs text-slate-500">Historical source: {formatDateTimeEastern(asset.atMoveObservedAt)}{asset.atMoveTiming==='NEXT_DAY_APPROXIMATION'?' · next-day approximation':''}</p>:null}
    </li>)}</ul>
    {!side.got.length?<p className="text-sm text-slate-600">{(side.faabReceived ?? 0)>0?'Received FAAB only; player and pick package value is 0.':'No player or pick received in the recorded ledger.'}</p>:null}
    {sides.length>2?<details className="mt-3 text-sm"><summary>Assets sent by {side.name}</summary><ul className="mt-2 space-y-1">{side.gave.map(a=><li key={a.id}>{a.label}</li>)}</ul></details>:null}
    {side.grades?<p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-600">Grade at trade: {side.grades.atTrade.grade??(side.grades.atTrade.status==='EXCLUDED'?'Not rated':'Unavailable')} → now: {side.grades.current.grade??(side.grades.current.status==='EXCLUDED'?'Not rated':'Unavailable')}</p>:null}
   </section>;
  })}</div>
  <details className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600"><summary className="cursor-pointer font-medium text-slate-800">How the winner and grades are calculated</summary><div className="mt-3 space-y-2">
   <p>The highest-value asset keeps its full price. Additional pieces are discounted for consolidation; picks retain more weight than depth players. This is the dashboard’s model, not KeepTradeCut’s proprietary calculator. Edge is received minus sent, divided by the larger adjusted package.</p>
   <p>Within 3% is even (B). Positive edges above 3%, 8%, 15%, and 25% earn B+, A−, A, and A+. The corresponding losing grades are B−, C+, C, and D.</p>
   <p>At trade uses verified provider observations within 24 hours before the trade, or a labeled first observation within 24 hours after it. Now uses fresh prices. Pick values are generic round averages; they do not assume an exact future draft position. Missing or stale player and pick prices withhold the grade.</p>
   <p>FAAB transfers are displayed but contribute 0 to every rating, at trade and now. A recorded FAAB-only payment is a valid side of a player or pick trade. A transfer containing only FAAB has no market grade. These rules apply to past trades and new trades as they sync.</p>
   {sides.length>2?<p>For a multi-team trade, each team’s incoming package is compared with its own outgoing package. More than one team can gain value.</p>:null}
  </div></details>
 </section>;
}
