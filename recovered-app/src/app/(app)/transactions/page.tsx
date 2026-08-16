import { prisma } from "@/lib/prisma";
import { getObservationSeries, type Obs } from "@/lib/metrics";
import { formatDateTimeEastern, formatPoints, formatSigned, trendColorClass } from "@/lib/format";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

const TYPE_LABEL: Record<string, string> = {
  trade: "Trade",
  waiver: "Waiver Claim",
  free_agent: "Free Agent",
  commissioner: "Commissioner Move",
};

export const dynamic = "force-dynamic";

type Kind = "add" | "drop";
type Bucket = "EARLY" | "MID" | "LATE";
type PickObs = { season:number; round:number; bucket:string; value:number; observedAt:Date; sourceUpdatedAt:Date|null; label:string };
type Asset = {
  assetType: "player" | "pick";
  label: string;
  detail?: string;
  managerName: string;
  rosterId: number;
  valueAtTx: number | null;
  currentValue: number | null;
  valueAtTxApprox: boolean;
  currentValueApprox?: boolean;
  valueSnapshotAt: Date | null;
  snapshotDistanceHours: number | null;
  playerId: string | null;
  kind: Kind;
};
type Side = {
  rosterId: number; managerName: string; incoming: Asset[]; outgoing: Asset[];
  atReceived: number; atSent: number; atNet: number; nowReceived: number; nowSent: number; nowNet: number;
  atCoverage: number; nowCoverage: number;
};
type RosterState = {
  observedAt: Date;
  byRoster: Map<number, { playerId:string; slot:string }[]>;
};

function nearestValid(series: Obs[], target: Date): Obs | null {
  const valid = series.filter((o) => o.validationStatus === "VALID");
  let best: Obs | null = null;
  let bestDistance = Infinity;
  for (const o of valid) {
    const distance = Math.abs(o.observedAt.getTime() - target.getTime());
    if (distance < bestDistance) { best = o; bestDistance = distance; }
  }
  return best;
}
function latestValid(series: Obs[]): Obs | null {
  return series.filter((o)=>o.validationStatus==="VALID").slice(-1)[0] ?? null;
}
function sumKnown(values: (number | null)[]) { return values.reduce<number>((sum, value) => sum + (value ?? 0), 0); }
function coverage(values: (number | null)[]) { return values.length === 0 ? 1 : values.filter((v) => v !== null).length / values.length; }
function pctDiff(a: number, b: number) { return b === 0 ? null : ((a - b) / Math.abs(b)) * 100; }
function winnerOf(sides: Side[], field: "atNet" | "nowNet") {
  if (sides.length < 2) return null;
  const sorted = [...sides].sort((a, b) => b[field] - a[field]);
  const edge = sorted[0][field];
  return edge <= 25 ? null : { side: sorted[0], edge };
}
function ordinal(round:number){return `${round}${round===1?'st':round===2?'nd':round===3?'rd':'th'}`;}
function bucketLabel(bucket:Bucket){return bucket[0]+bucket.slice(1).toLowerCase();}
function Confetti() {
  return <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl opacity-80">
    {[12,26,41,63,78,91].map((x,i)=><span key={x} className="confetti-bit" style={{ left:`${x}%`, animationDelay:`${i*90}ms` }} />)}
  </div>;
}

export default async function TransactionsPage() {
  const db = prisma as typeof prisma & { draftPickObservation:any };
  const [transactions, managers, players, pickObservations, snapshots, ownershipIntervals] = await Promise.all([
    prisma.transaction.findMany({ where:{ league:{ sleeperId:SLEEPER_LEAGUE_ID } }, orderBy: { sleeperCreatedAt: "desc" }, take: 100 }),
    prisma.manager.findMany({ where:{ league:{ sleeperId:SLEEPER_LEAGUE_ID } } }),
    prisma.player.findMany({ select: { id: true, sleeperId: true, fullName: true, position: true } }),
    db.draftPickObservation.findMany({ orderBy:{ observedAt:"asc" } }) as Promise<PickObs[]>,
    prisma.rosterSnapshot.findMany({
      where:{ manager:{ league:{ sleeperId:SLEEPER_LEAGUE_ID } } },
      select:{ refreshRunId:true, observedAt:true, slot:true, playerId:true, manager:{ select:{ sleeperRosterId:true } } },
      orderBy:{ observedAt:"asc" },
    }),
    prisma.ownershipInterval.findMany({
      where:{ manager:{ league:{ sleeperId:SLEEPER_LEAGUE_ID } } },
      select:{ playerId:true, validFrom:true, validTo:true, manager:{ select:{ sleeperRosterId:true } } },
    }),
  ]);
  const managerByRosterId = new Map(managers.map((m) => [m.sleeperRosterId, m]));
  const playerBySleeperId = new Map(players.map((p) => [p.sleeperId, p]));
  const series = await getObservationSeries(players.map((p) => p.id));

  function managerName(rosterId: number) {
    const m = managerByRosterId.get(rosterId);
    return m?.teamName ?? m?.displayName ?? `Roster ${rosterId}`;
  }

  // Group saved roster snapshots by refresh run. These make pick-slot projection
  // reproducible instead of relying on whichever roster happens to be current.
  const stateByRun = new Map<string,RosterState>();
  for(const row of snapshots){
    let state=stateByRun.get(row.refreshRunId);
    if(!state){state={observedAt:row.observedAt,byRoster:new Map()};stateByRun.set(row.refreshRunId,state);}
    const rid=row.manager.sleeperRosterId;
    const list=state.byRoster.get(rid)??[];
    list.push({playerId:row.playerId,slot:row.slot});
    state.byRoster.set(rid,list);
  }
  const states=[...stateByRun.values()].sort((a,b)=>a.observedAt.getTime()-b.observedAt.getTime());
  if(states.length===0){
    const fallback: RosterState={observedAt:new Date(),byRoster:new Map()};
    for(const oi of ownershipIntervals.filter((x)=>x.validTo===null)){
      const rid=oi.manager.sleeperRosterId; const list=fallback.byRoster.get(rid)??[];
      list.push({playerId:oi.playerId,slot:"BENCH"}); fallback.byRoster.set(rid,list);
    }
    states.push(fallback);
  }

  function nearestState(target:Date, latest=false){
    if(latest) return states[states.length-1];
    let best=states[0],distance=Math.abs(best.observedAt.getTime()-target.getTime());
    for(const s of states){const d=Math.abs(s.observedAt.getTime()-target.getTime());if(d<distance){best=s;distance=d;}}
    return best;
  }
  const powerCache=new Map<string,{rank:number;bucket:Bucket;stateDistanceHours:number;power:number}>();
  function projectBucket(originalRosterId:number,target:Date,latest=false){
    const key=`${originalRosterId}:${latest?'LATEST':target.toISOString()}`;
    const cached=powerCache.get(key); if(cached)return cached;
    const state=nearestState(target,latest);
    const targetForValues=latest?new Date():target;
    const slotWeight:Record<string,number>={STARTER:1.20,BENCH:.75,TAXI:.45,IR:.60};
    const powers=[...managerByRosterId.keys()].map((rid)=>{
      const roster=state.byRoster.get(rid)??[];
      let total=0;
      for(const rp of roster){
        const obs=latest?latestValid(series.get(rp.playerId)??[]):nearestValid(series.get(rp.playerId)??[],targetForValues);
        if(obs) total+=obs.value*(slotWeight[rp.slot]??.75);
      }
      return {rid,total};
    }).sort((a,b)=>b.total-a.total);
    const rank=Math.max(1,powers.findIndex((x)=>x.rid===originalRosterId)+1 || powers.length);
    const bucket:Bucket=rank<=4?"LATE":rank<=8?"MID":"EARLY";
    const result={rank,bucket,stateDistanceHours:Math.abs(state.observedAt.getTime()-target.getTime())/3_600_000,power:powers.find(x=>x.rid===originalRosterId)?.total??0};
    powerCache.set(key,result);return result;
  }

  function pickValue(season:number,round:number,bucket:Bucket,target:Date,latest=false){
    const exact=pickObservations.filter((o)=>o.season===season&&o.round===round&&o.bucket===bucket);
    if(exact.length){
      const obs=latest?exact[exact.length-1]:exact.reduce((best,o)=>Math.abs(o.observedAt.getTime()-target.getTime())<Math.abs(best.observedAt.getTime()-target.getTime())?o:best,exact[0]);
      return {value:obs.value,observedAt:obs.observedAt,distanceHours:Math.abs(obs.observedAt.getTime()-target.getTime())/3_600_000,derived:false};
    }
    // KTC currently publishes only a limited number of future draft classes.
    // If a farther-out class is traded, derive it from the same round/bucket's
    // published year curve rather than silently assigning zero.
    const same=pickObservations.filter((o)=>o.round===round&&o.bucket===bucket);
    if(!same.length)return {value:null,observedAt:null,distanceHours:null,derived:true};
    const bySeason=new Map<number,PickObs>();
    for(const o of same){
      const prev=bySeason.get(o.season);
      if(!prev || (latest?o.observedAt>prev.observedAt:Math.abs(o.observedAt.getTime()-target.getTime())<Math.abs(prev.observedAt.getTime()-target.getTime())))bySeason.set(o.season,o);
    }
    const pts=[...bySeason.entries()].sort((a,b)=>a[0]-b[0]);
    let value:number;
    if(season<pts[0][0]) value=pts[0][1].value;
    else if(season>pts[pts.length-1][0]){
      const ratios:number[]=[];
      for(let i=1;i<pts.length;i++) if(pts[i-1][1].value>0) ratios.push(pts[i][1].value/pts[i-1][1].value);
      ratios.sort((a,b)=>a-b); const ratio=Math.max(.65,Math.min(.98,ratios.length?ratios[Math.floor(ratios.length/2)]:.82));
      value=pts[pts.length-1][1].value*Math.pow(ratio,season-pts[pts.length-1][0]);
    }else{
      const hi=pts.findIndex(([yr])=>yr>=season); if(pts[hi][0]===season)value=pts[hi][1].value; else {const [y0,o0]=pts[hi-1],[y1,o1]=pts[hi];const t=(season-y0)/(y1-y0);value=o0.value+t*(o1.value-o0.value);}
    }
    const nearest=pts.reduce((best,x)=>Math.abs(x[0]-season)<Math.abs(best[0]-season)?x:best,pts[0])[1];
    return {value:Math.round(value),observedAt:nearest.observedAt,distanceHours:Math.abs(nearest.observedAt.getTime()-target.getTime())/3_600_000,derived:true};
  }

  function playerAsset(sleeperPid:string,rosterId:number,txDate:Date,kind:Kind):Asset{
    const player=playerBySleeperId.get(sleeperPid);
    if(!player)return{assetType:"player",label:`Unmapped player (${sleeperPid})`,managerName:managerName(rosterId),rosterId,valueAtTx:null,currentValue:null,valueAtTxApprox:false,valueSnapshotAt:null,snapshotDistanceHours:null,playerId:null,kind};
    const obs=series.get(player.id)??[],atTx=nearestValid(obs,txDate),latest=latestValid(obs);
    const distanceHours=atTx?Math.abs(atTx.observedAt.getTime()-txDate.getTime())/3_600_000:null;
    return{assetType:"player",label:`${player.fullName} (${player.position})`,managerName:managerName(rosterId),rosterId,valueAtTx:atTx?.value??null,currentValue:latest?.value??null,valueAtTxApprox:!!atTx&&distanceHours!>24,valueSnapshotAt:atTx?.observedAt??null,snapshotDistanceHours:distanceHours,playerId:player.id,kind};
  }

  function pickAssets(p:Record<string,unknown>,txDate:Date):Asset[]{
    const season=Number(p.season),round=Number(p.round),originalRosterId=Number(p.roster_id),previous=Number(p.previous_owner_id),owner=Number(p.owner_id);
    if(!Number.isFinite(season)||!Number.isFinite(round)||!Number.isFinite(originalRosterId)||!Number.isFinite(previous)||!Number.isFinite(owner))return[];
    const atProjection=projectBucket(originalRosterId,txDate,false),nowProjection=projectBucket(originalRosterId,new Date(),true);
    const at=pickValue(season,round,atProjection.bucket,txDate,false),now=pickValue(season,round,nowProjection.bucket,new Date(),true);
    const originalName=managerName(originalRosterId);
    const detail=`${originalName} pick · ${bucketLabel(atProjection.bucket)} at trade (#${atProjection.rank}/12 power) → ${bucketLabel(nowProjection.bucket)} now (#${nowProjection.rank}/12)`;
    const base={assetType:"pick" as const,label:`${season} ${ordinal(round)} · ${bucketLabel(nowProjection.bucket)} projection`,detail,valueAtTx:at.value,currentValue:now.value,valueAtTxApprox:at.derived||atProjection.stateDistanceHours>24*7||(at.distanceHours??Infinity)>24,currentValueApprox:now.derived,valueSnapshotAt:at.observedAt,snapshotDistanceHours:at.distanceHours,playerId:null};
    return[
      {...base,managerName:managerName(owner),rosterId:owner,kind:"add" as Kind},
      {...base,managerName:managerName(previous),rosterId:previous,kind:"drop" as Kind},
    ];
  }

  const rows=transactions.map((t)=>{
    const adds=t.adds?JSON.parse(t.adds) as Record<string,number>:{};
    const drops=t.drops?JSON.parse(t.drops) as Record<string,number>:{};
    const draftPicks=t.draftPicks?JSON.parse(t.draftPicks) as Array<Record<string,unknown>>:[];
    const waiverBudget=t.waiverBudget?JSON.parse(t.waiverBudget) as Array<Record<string,unknown>>:[];
    const rosterIds=new Set<number>(JSON.parse(t.rosterIdsInvolved||"[]") as number[]);
    Object.values(adds).forEach(r=>rosterIds.add(Number(r)));Object.values(drops).forEach(r=>rosterIds.add(Number(r)));
    draftPicks.forEach(p=>{if(p.owner_id!=null)rosterIds.add(Number(p.owner_id));if(p.previous_owner_id!=null)rosterIds.add(Number(p.previous_owner_id));});
    waiverBudget.forEach(p=>{if(p.receiver!=null)rosterIds.add(Number(p.receiver));if(p.sender!=null)rosterIds.add(Number(p.sender));});
    const assets:Asset[]=[...Object.entries(adds).map(([pid,rid])=>playerAsset(pid,Number(rid),t.sleeperCreatedAt,"add")),...Object.entries(drops).map(([pid,rid])=>playerAsset(pid,Number(rid),t.sleeperCreatedAt,"drop")),...draftPicks.flatMap(p=>pickAssets(p,t.sleeperCreatedAt))];
    const sides:Side[]=[...rosterIds].map(rosterId=>{
      const incoming=assets.filter(a=>a.kind==="add"&&a.rosterId===rosterId),outgoing=assets.filter(a=>a.kind==="drop"&&a.rosterId===rosterId);
      const inAt=incoming.map(a=>a.valueAtTx),outAt=outgoing.map(a=>a.valueAtTx),inNow=incoming.map(a=>a.currentValue),outNow=outgoing.map(a=>a.currentValue);
      const atReceived=sumKnown(inAt),atSent=sumKnown(outAt),nowReceived=sumKnown(inNow),nowSent=sumKnown(outNow);
      return{rosterId,managerName:managerName(rosterId),incoming,outgoing,atReceived,atSent,atNet:atReceived-atSent,nowReceived,nowSent,nowNet:nowReceived-nowSent,atCoverage:coverage([...inAt,...outAt]),nowCoverage:coverage([...inNow,...outNow])};
    }).filter(s=>s.incoming.length+s.outgoing.length>0);
    return{...t,assets,sides,atWinner:winnerOf(sides,"atNet"),nowWinner:winnerOf(sides,"nowNet"),draftPicks,waiverBudget,hasMissing:sides.some(s=>s.atCoverage<1||s.nowCoverage<1)};
  });

  const tradeRows = rows.filter((t)=>t.type==="trade" && t.sides.length>=2);
  const scoreByRoster = new Map<number,{rosterId:number;managerName:string;trades:number;atEdge:number;nowEdge:number;thenWins:number;nowWins:number}>();
  for(const t of tradeRows){
    for(const side of t.sides){
      const cur=scoreByRoster.get(side.rosterId)??{rosterId:side.rosterId,managerName:side.managerName,trades:0,atEdge:0,nowEdge:0,thenWins:0,nowWins:0};
      cur.trades+=1;cur.atEdge+=side.atNet;cur.nowEdge+=side.nowNet;
      if(t.atWinner?.side.rosterId===side.rosterId)cur.thenWins+=1;
      if(t.nowWinner?.side.rosterId===side.rosterId)cur.nowWins+=1;
      scoreByRoster.set(side.rosterId,cur);
    }
  }
  const tradeScoreboard=[...scoreByRoster.values()].sort((a,b)=>b.nowEdge-a.nowEdge);
  const bestTradeSide=tradeRows.flatMap(t=>t.sides.map(side=>({side,t}))).sort((a,b)=>b.side.nowNet-a.side.nowNet)[0]??null;
  const typeCounts=rows.reduce<Record<string,number>>((acc,t)=>{acc[t.type]=(acc[t.type]??0)+1;return acc;},{});

  return <div className="page-enter space-y-6">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-xl font-semibold text-neutral-100">Transaction Ledger</h1><p className="max-w-3xl text-sm text-neutral-500">Trades are graded with total KTC value: players plus KTC-valued draft picks. Pick slots are projected Early/Mid/Late from the original pick team’s league power at the transaction and at the latest update.</p></div>
      <div className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-[11px] text-emerald-300">● Re-graded every market refresh</div>
    </div>

    <section className="grid gap-3 lg:grid-cols-[1.1fr_.9fr]">
      <div className="panel p-4">
        <div className="eyebrow">Trade scoreboard</div>
        <h2 className="mt-1 text-sm font-semibold text-neutral-100">Cumulative value edge by manager</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">“Now edge” sums the current value of assets received minus assets sent across each trade ledger entry. It is a trade-book score, not team value or realized profit.</p>
        <div className="mt-3 divide-y divide-neutral-800/80">
          {tradeScoreboard.slice(0,8).map((m,i)=><div key={m.rosterId} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><span className="mr-2 text-[10px] text-neutral-600">#{i+1}</span><span className="text-sm font-medium text-neutral-100">{m.managerName}</span><div className="pl-5 text-[10px] text-neutral-600">{m.trades} trades · {m.thenWins} won then · {m.nowWins} winning now</div></div><div className="text-right"><div className={`font-semibold ${trendColorClass(m.nowEdge)}`}>{formatSigned(m.nowEdge)}</div><div className={`text-[10px] ${trendColorClass(m.atEdge)}`}>at deal {formatSigned(m.atEdge)}</div></div></div>)}
          {tradeScoreboard.length===0&&<div className="py-4 text-xs text-neutral-500">No multi-team trades recorded yet.</div>}
        </div>
      </div>
      <div className="space-y-3">
        <div className="panel grid grid-cols-3 gap-2 p-4 text-center"><div><div className="metric-label">Trades</div><div className="metric-value">{typeCounts.trade??0}</div></div><div><div className="metric-label">Waivers</div><div className="metric-value">{typeCounts.waiver??0}</div></div><div><div className="metric-label">Free agents</div><div className="metric-value">{typeCounts.free_agent??0}</div></div></div>
        <div className="panel p-4"><div className="eyebrow">Biggest current trade edge</div>{bestTradeSide?<><div className="mt-2 text-base font-semibold text-neutral-100">{bestTradeSide.side.managerName}</div><div className={`mt-1 text-2xl font-bold ${trendColorClass(bestTradeSide.side.nowNet)}`}>{formatSigned(bestTradeSide.side.nowNet)}</div><div className="mt-1 text-[11px] text-neutral-500">Current received-minus-sent value on one recorded trade.</div></>:<div className="mt-2 text-sm text-neutral-500">No trade edge yet.</div>}</div>
      </div>
    </section>

    <div className="space-y-4">{rows.map((t,txIndex)=>{
      const isTrade=t.type==="trade"&&t.sides.length>=2,single=t.sides[0]??null,moveAt=single?.atNet??0,moveNow=single?.nowNet??0;
      return <article key={t.id} className="interactive-card relative overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/90 p-3 shadow-2xl shadow-black/10 sm:p-4" style={{animationDelay:`${Math.min(txIndex,8)*35}ms`}}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md border border-neutral-700/70 bg-neutral-800 px-2.5 py-1 font-medium text-neutral-200">{TYPE_LABEL[t.type]??t.type}</span>{t.draftPicks.length>0&&<span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">players + KTC-priced picks</span>}{t.waiverBudget.length>0&&<span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">FAAB shown separately</span>}</div><span>{formatDateTimeEastern(t.sleeperCreatedAt.toISOString())}</span></div>
        {isTrade?<>
          <div className="mb-3 grid gap-2 sm:grid-cols-2"><WinnerCard title="Winner at transaction" winner={t.atWinner} tone="emerald"/><WinnerCard title="Winner now" winner={t.nowWinner} tone="cyan"/></div>
          <div className={`grid gap-3 ${t.sides.length===2?'lg:grid-cols-2':'lg:grid-cols-3'}`}>{t.sides.map(side=>{
            const atPct=pctDiff(side.atReceived,side.atSent),nowPct=pctDiff(side.nowReceived,side.nowSent),atWin=t.atWinner?.side.rosterId===side.rosterId,nowWin=t.nowWinner?.side.rosterId===side.rosterId;
            return <section key={side.rosterId} className={`rounded-xl border bg-neutral-950/70 p-3 transition duration-300 hover:-translate-y-0.5 ${atWin||nowWin?'border-emerald-500/25':'border-neutral-800'}`}>
              <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-semibold text-neutral-100">{side.managerName}</h2><div className="flex gap-1">{atWin&&<span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">🏆 THEN</span>}{nowWin&&<span className="rounded-full bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-300">🏆 NOW</span>}</div></div>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-neutral-900/80 p-2 text-xs"><div><div className="text-neutral-600">At transaction</div><div className={trendColorClass(side.atNet)}>{formatSigned(side.atNet)} net {atPct!==null&&<span className="text-[10px] opacity-70">({atPct>0?'+':''}{atPct.toFixed(1)}%)</span>}</div></div><div><div className="text-neutral-600">Latest update</div><div className={trendColorClass(side.nowNet)}>{formatSigned(side.nowNet)} net {nowPct!==null&&<span className="text-[10px] opacity-70">({nowPct>0?'+':''}{nowPct.toFixed(1)}%)</span>}</div></div></div>
              <div className="mt-3 space-y-2">{side.incoming.map((a,i)=><AssetRow key={`in-${i}`} asset={a}/>)}{side.outgoing.map((a,i)=><AssetRow key={`out-${i}`} asset={a}/>)}</div>
              <div className="mt-3 grid grid-cols-2 border-t border-neutral-800 pt-2 text-[11px] text-neutral-500"><div>Received: <span className="text-neutral-300">{formatPoints(side.atReceived)} → {formatPoints(side.nowReceived)}</span></div><div className="text-right">Sent: <span className="text-neutral-300">{formatPoints(side.atSent)} → {formatPoints(side.nowSent)}</span></div></div>
            </section>})}</div>
        </>:<>
          {single&&<div className={`mb-3 relative overflow-hidden rounded-xl border p-3 ${moveAt>=0?'border-emerald-500/30 bg-emerald-500/[0.06]':'border-red-500/25 bg-red-500/[0.04]'}`}>{moveAt>25&&<Confetti/>}<div className="relative flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Move verdict</div><div className="mt-1 text-base font-semibold text-neutral-100">{moveAt>25?`🏆 ${single.managerName} added value`:moveAt<-25?`📉 ${single.managerName} lost value on the move`:`🤝 ${single.managerName}: valuation incomplete`}</div></div><div className="grid grid-cols-2 gap-4 text-right"><div><div className="text-[10px] text-neutral-500">At move</div><div className={`font-bold ${trendColorClass(moveAt)}`}>{formatSigned(moveAt)}</div></div><div><div className="text-[10px] text-neutral-500">Now</div><div className={`font-bold ${trendColorClass(moveNow)}`}>{formatSigned(moveNow)}</div></div></div></div></div>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{t.assets.map((a,i)=><AssetRow key={i} asset={a}/>)}</div>
        </>}
        {(t.hasMissing||t.waiverBudget.length>0)&&<div className="mt-3 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2 text-[11px] text-amber-200/80">{t.hasMissing?'⚠ Valuation incomplete: at least one asset lacks a usable saved market value, so this move cannot be graded as even or as a win. ':''}{t.waiverBudget.length>0?'FAAB is not assigned a fake KTC value; it remains a separate transaction asset.':''}</div>}
      </article>})}{rows.length===0&&<p className="text-sm text-neutral-500">No transactions recorded yet. Run a refresh to sync them.</p>}</div>
  </div>;
}

function WinnerCard({title,winner,tone}:{title:string;winner:{side:Side;edge:number}|null;tone:"emerald"|"cyan"}){
  const border=tone==="emerald"?'border-emerald-500/30 bg-emerald-500/[0.06]':'border-cyan-500/30 bg-cyan-500/[0.05]';
  const text=tone==="emerald"?'text-emerald-300':'text-cyan-300';
  return <div className={`relative overflow-hidden rounded-xl border p-3 ${winner?border:'border-neutral-800 bg-neutral-950/60'}`}>{winner&&<Confetti/>}<div className="relative flex items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">{title}</div><div className="mt-1 text-base font-semibold text-neutral-100">{winner?`🏆 ${winner.side.managerName}`:'🤝 Too close to call'}</div></div>{winner&&<div className="value-pop text-right"><div className={`text-lg font-bold ${text}`}>+{formatPoints(winner.edge)}</div><div className="text-[10px] text-neutral-500">total asset edge</div></div>}</div></div>;
}

function AssetRow({asset:a}:{asset:Asset}){
  const delta=a.currentValue!==null&&a.valueAtTx!==null?a.currentValue-a.valueAtTx:null;
  return <div className="group flex items-center justify-between gap-3 rounded-lg border border-neutral-900 bg-black/35 px-3 py-2.5 transition duration-200 hover:border-neutral-700 hover:bg-neutral-900/80">
    <div className="min-w-0"><div className="truncate text-sm"><span className={a.kind==="add"?'text-emerald-400':'text-red-400'}>{a.kind==="add"?'+ ':'− '}</span><span className="text-neutral-100">{a.assetType==="pick"?'🎟️ ':''}{a.label}</span></div><div className="text-[10px] text-neutral-600">{a.kind==="add"?'received':'sent'} · {a.managerName}</div>{a.detail&&<div className="mt-0.5 text-[9px] text-neutral-600">{a.detail}</div>}</div>
    <div className="shrink-0 text-right text-xs"><div className="text-neutral-400">then {formatPoints(a.valueAtTx)}{a.valueAtTxApprox&&<span className="text-amber-500"> ~</span>}</div>{a.currentValue!==null&&<div className={trendColorClass(delta)}>now {formatPoints(a.currentValue)}{a.currentValueApprox&&<span className="text-amber-500"> ~</span>} {delta!==null&&<span>({formatSigned(delta)})</span>}</div>}{a.snapshotDistanceHours!==null&&a.snapshotDistanceHours>48&&<div className="text-[9px] text-amber-500/70">nearest saved market snapshot {Math.round(a.snapshotDistanceHours/24)}d away</div>}</div>
  </div>;
}
