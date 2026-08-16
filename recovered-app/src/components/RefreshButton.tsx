"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SourceStatus { source:string; enabled:boolean; ok:boolean; eligibleForConsensus:boolean; rowsStored:number; message:string; sourceUpdatedAt:string|null; }
interface RunView {
  runId:string; status:"RUNNING"|"SUCCESS"|"PARTIAL_FAILURE"|"FAILED"; startedAt:string; finishedAt:string|null;
  requestedSources:string[]; sleeperSyncOk:boolean|null; ktcSyncOk:boolean|null; rosterChangesCount:number; playersRefreshed:number;
  ktcPlayersStored:number; ktcFlagged:number; mappingWarningsCount:number; transactionsRecorded:number; marketObservationsStored:number;
  consensusPlayersStored:number; marketSourceStatuses:SourceStatus[]; errors:{source:string;message:string}[];
}
interface Capabilities { autoRefreshOnVisit:boolean; ktcAutoRefreshEnabled:boolean; ktcMode:string; sources:Record<string,boolean>; freshnessHours:number; }
function timeAgo(iso:string|null){if(!iso)return"never";const ms=Date.now()-new Date(iso).getTime();const mins=Math.floor(ms/60000);if(mins<1)return"just now";if(mins<60)return`${mins}m ago`;const hrs=Math.floor(mins/60);if(hrs<24)return`${hrs}h ago`;return`${Math.floor(hrs/24)}d ago`;}

export default function RefreshButton(){
  const router=useRouter();const[run,setRun]=useState<RunView|null>(null);const[capabilities,setCapabilities]=useState<Capabilities|null>(null);
  const[error,setError]=useState<string|null>(null);const[showSummary,setShowSummary]=useState(false);const pollRef=useRef<ReturnType<typeof setInterval>|null>(null);const autoStartedRef=useRef(false);
  function clearPoll(){if(pollRef.current){clearInterval(pollRef.current);pollRef.current=null;}}
  function pollRun(runId:string){clearPoll();pollRef.current=setInterval(async()=>{try{const res=await fetch(`/api/refresh/${runId}`,{cache:"no-store"});const data=await res.json();if(!data.run)return;setRun(data.run);if(data.run.status!=="RUNNING"){clearPoll();setShowSummary(true);router.refresh();setTimeout(()=>setShowSummary(false),12000);}}catch{}},1200);}
  async function loadLatest(){const res=await fetch("/api/refresh",{cache:"no-store"});if(!res.ok)throw new Error("Could not load refresh status");const data=await res.json();const nextRun=(data.run??null)as RunView|null;const caps=(data.capabilities??null)as Capabilities|null;setRun(nextRun);setCapabilities(caps);return{run:nextRun,capabilities:caps};}
  async function startNewRefresh(showStartError:boolean){setError(null);const res=await fetch("/api/refresh",{method:"POST"});const data=await res.json();if(!res.ok){try{const latest=await loadLatest();if(latest.run?.status==="RUNNING"){pollRun(latest.run.runId);return;}}catch{}if(showStartError)setError(data.error??"Failed to start refresh");return;}const running:RunView={runId:data.runId,status:"RUNNING",startedAt:new Date().toISOString(),finishedAt:null,requestedSources:["sleeper","ktc","statsguy","consensus","nflverse-context"],sleeperSyncOk:null,ktcSyncOk:null,rosterChangesCount:0,playersRefreshed:0,ktcPlayersStored:0,ktcFlagged:0,mappingWarningsCount:0,transactionsRecorded:0,marketObservationsStored:0,consensusPlayersStored:0,marketSourceStatuses:[],errors:[]};setRun(running);setShowSummary(false);pollRun(data.runId);}
  useEffect(()=>{let cancelled=false;(async()=>{try{const latest=await loadLatest();if(cancelled)return;if(latest.run?.status==="RUNNING"){pollRun(latest.run.runId);return;}if(latest.capabilities?.autoRefreshOnVisit&&!autoStartedRef.current){autoStartedRef.current=true;await startNewRefresh(false);}}catch{}})();return()=>{cancelled=true;clearPoll();};/* eslint-disable-next-line react-hooks/exhaustive-deps */},[]);
  const isRunning=run?.status==="RUNNING";
  return <div className="relative">
    <button onClick={()=>startNewRefresh(true)} disabled={isRunning} title="Sync Sleeper, KTC, Stats Guy Fantasy, and NFL context, then rebuild the verified-source consensus." className="flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[11px] sm:gap-2 sm:px-3 sm:text-xs font-medium text-neutral-100 transition hover:border-emerald-600 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60">
      {isRunning?<><span className="h-2 w-2 animate-pulse rounded-full bg-amber-400"/>Refreshing…</>:<><span className="h-2 w-2 rounded-full bg-emerald-500"/>Refresh Data</>}
    </button>
    {!isRunning&&run?.finishedAt&&<p className="mt-1 text-right text-[10px] text-neutral-500">Last refresh: {timeAgo(run.finishedAt)}</p>}
    {error&&<p className="mt-1 text-right text-[10px] text-red-400">{error}</p>}
    {showSummary&&run&&run.status!=="RUNNING"&&<div className="fixed left-3 right-3 top-24 z-30 mt-2 max-h-[65vh] overflow-y-auto rounded-md sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-96 sm:max-h-none border border-neutral-700 bg-neutral-900 p-3 text-xs shadow-xl">
      <p className={`mb-1 font-medium ${run.status==="SUCCESS"?"text-emerald-400":"text-amber-400"}`}>{run.status==="SUCCESS"?"Refresh complete":run.status==="PARTIAL_FAILURE"?"Refresh completed with source exclusions":"Refresh failed"}</p>
      <p className="text-neutral-400">Sleeper: {run.playersRefreshed} players · {run.rosterChangesCount} roster changes · {run.transactionsRecorded} new transactions</p>
      {run.marketSourceStatuses.filter((s)=>s.enabled).map((s)=><p key={s.source} className={`mt-1 ${s.ok?"text-neutral-400":"text-amber-400"}`}>{s.source}: {s.ok?`${s.rowsStored} league-player observations stored`:s.message}</p>)}
      {run.consensusPlayersStored>0&&<p className="mt-1 text-emerald-400">Consensus rebuilt for {run.consensusPlayersStored} players using fresh sources only.</p>}
      {run.errors.length>0&&<p className="mt-1 text-neutral-500">Prior valid data was preserved for any failed/stale source.</p>}
    </div>}
  </div>;
}
