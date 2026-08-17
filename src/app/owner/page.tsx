"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Strategy = "UNTOUCHABLE" | "KEEP" | "AVAILABLE" | "SHOP" | "TARGET" | "AVOID";
type PlayerState = { id:string; name:string; position:string; nflTeam:string|null; status:Strategy|null };
const OPTIONS: Array<{ value:""|Strategy; label:string }> = [
  { value:"", label:"No private preference" },
  { value:"UNTOUCHABLE", label:"Untouchable" },
  { value:"KEEP", label:"Prefer to keep" },
  { value:"AVAILABLE", label:"Available" },
  { value:"SHOP", label:"Actively shop" },
  { value:"TARGET", label:"Target" },
  { value:"AVOID", label:"Avoid" },
];

export default function OwnerPage(){
  const[key,setKey]=useState("");
  const[players,setPlayers]=useState<PlayerState[]>([]);
  const[message,setMessage]=useState("Enter the owner key to load private controls.");
  const[busy,setBusy]=useState(false);

  useEffect(()=>{const saved=sessionStorage.getItem("dynasty-owner-key");if(saved)setKey(saved)},[]);

  async function load(){
    if(!key.trim())return setMessage("Owner key required.");
    setBusy(true);setMessage("Loading private owner state…");
    try{
      const res=await fetch("/api/admin/state",{headers:{"x-admin-key":key.trim()},cache:"no-store"});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error??"Owner authorization failed.");
      sessionStorage.setItem("dynasty-owner-key",key.trim());
      setPlayers(data.players??[]);setMessage("Private owner controls loaded for this browser session only.");
    }catch(error){setPlayers([]);setMessage(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
  }

  async function update(playerId:string,status:""|Strategy){
    setBusy(true);
    try{
      const res=await fetch("/api/admin/strategy",{method:"POST",headers:{"content-type":"application/json","x-admin-key":key.trim()},body:JSON.stringify({playerId,status:status||null})});
      const data=await res.json();if(!res.ok)throw new Error(data.error??"Could not update strategy.");
      setPlayers(rows=>rows.map(row=>row.id===playerId?{...row,status:(status||null) as Strategy|null}:row));
      setMessage("Private strategy updated. Trade Lab will use it immediately.");
    }catch(error){setMessage(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
  }

  async function refresh(){
    setBusy(true);setMessage("Starting refresh…");
    try{
      const res=await fetch("/api/admin/refresh",{method:"POST",headers:{"x-admin-key":key.trim()}});const data=await res.json();
      if(!res.ok)throw new Error(data.error??"Could not start refresh.");
      setMessage(`Refresh started${data.runId?` · run ${data.runId}`:""}. Data pages update when the run finishes.`);
    }catch(error){setMessage(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
  }

  function forget(){sessionStorage.removeItem("dynasty-owner-key");setKey("");setPlayers([]);setMessage("Owner key removed from this browser session.")}

  return <main className="mx-auto min-h-screen max-w-5xl bg-neutral-950 px-4 py-8 text-neutral-100 sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-600">Unlinked owner utility</div><h1 className="mt-1 text-2xl font-semibold">Owner Controls</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">This is separate from the public dashboard. The key is kept in sessionStorage only and is never rendered into public pages or URLs.</p></div><Link href="/" className="rounded-md border border-neutral-800 px-3 py-2 text-xs text-neutral-400 hover:text-neutral-100">← Dashboard</Link></div>
    <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4"><label className="text-[10px] uppercase tracking-wide text-neutral-600">Owner key</label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input type="password" value={key} onChange={e=>setKey(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void load()}} autoComplete="off" className="h-10 min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm outline-none focus:border-emerald-700" placeholder="Private admin key"/><button disabled={busy} onClick={()=>void load()} className="rounded-md bg-emerald-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Load controls</button><button onClick={forget} className="rounded-md border border-neutral-700 px-4 py-2 text-xs text-neutral-400">Forget key</button></div><p className="mt-2 text-[11px] text-neutral-500">{message}</p></section>
    {players.length?<><section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4"><div><div className="text-sm font-semibold">Private maintenance</div><p className="mt-1 text-[10px] text-neutral-600">Manual refresh is owner-only; normal visitors cannot trigger it.</p></div><button disabled={busy} onClick={()=>void refresh()} className="rounded-md border border-emerald-800 bg-emerald-950/30 px-4 py-2 text-xs font-medium text-emerald-300 disabled:opacity-50">Refresh data now</button></section><section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4"><div><h2 className="text-sm font-semibold">Private roster strategy</h2><p className="mt-1 text-[10px] leading-4 text-neutral-600">These preferences affect generated Trade Lab offers but are not displayed on the public dashboard.</p></div><div className="mt-4 grid gap-2 md:grid-cols-2">{players.map(player=><div key={player.id} className="grid grid-cols-[1fr_minmax(140px,180px)] items-center gap-3 rounded-lg bg-neutral-950 p-3"><div className="min-w-0"><div className="truncate text-sm font-medium text-neutral-100">{player.name}</div><div className="text-[10px] text-neutral-600">{player.position}{player.nflTeam?` · ${player.nflTeam}`:""}</div></div><select disabled={busy} value={player.status??""} onChange={e=>void update(player.id,e.target.value as ""|Strategy)} className="h-9 rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-300">{OPTIONS.map(option=><option key={option.value||"none"} value={option.value}>{option.label}</option>)}</select></div>)}</div></section></>:null}
  </main>
}
