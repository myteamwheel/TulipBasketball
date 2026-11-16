"use client";

import { useMemo, useState } from "react";
import { pickLabel, rankManagers, type Grade, type GradedPick, type Lens } from "@/lib/draftGrades";

const PAGE = 16;
const format = (v:number) => v.toLocaleString("en-US");
const box = "rounded-xl border border-[var(--border)] bg-[var(--surface)]";
const muted = "text-[var(--text-muted)]";
const control = "min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm";
function Badge({g}:{g:Grade|null}) {
  return <strong className={'inline-flex min-w-8 items-center justify-center rounded px-1.5 py-0.5 text-base '+(g?.letter==="A" ? "bg-[var(--positive-badge)] text-[var(--positive)]" : g?.letter==="F" ? "bg-[var(--negative-surface)] text-[var(--negative)]" : "bg-[var(--surface-raised)]")}>{g?.letter ?? "—"}</strong>;
}

function leaders(group: GradedPick[], lens: Lens) {
  const managers=rankManagers(group,lens);
  if (managers[0]?.average == null) return "No graded picks";
  return managers.filter(m=>m.average===managers[0].average).map(m=>`${m.name} (${m.graded})`).join(" · ");
}

function Leaderboards({picks,lens,setLens}:{picks:GradedPick[];lens:Lens;setLens:(value:Lens)=>void}) {
  const managers = rankManagers(picks,lens);
  const ranked = picks.filter(p=>p[lens] !== null).sort((a,b)=>b[lens]!.edge-a[lens]!.edge);
  const best = ranked[0], worst = ranked.at(-1);
  const awards = (p:GradedPick|undefined) => !p ? "No graded selections" : ranked.filter(r=>Math.abs(r[lens]!.edge-p[lens]!.edge)<1e-9).map(r=>`${r.name} · ${r.year} ${pickLabel(r)} · ${r.manager ?? "Selector unknown"}`).join(" / ");
  const maxF = Math.max(0,...managers.map(m=>m.fs));
  const years = [...new Set(picks.map(p=>p.year))].sort((a,b)=>b-a);
  const rookie = picks.filter(p=>!p.auction);
  const rounds = [...new Set(rookie.map(p=>p.round))].sort((a,b)=>a-b);
  return <section id="draft-leaders" className="scroll-mt-40 space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold">Drafter leaderboard</h2><p className={muted}>All managers in the selected season. Tied picks share honors.</p></div>
      <label className="text-xs">Rank using<select className={control} value={lens} onChange={e=>setLens(e.target.value as Lens)}><option value="outcome">Grade now</option><option value="entry">Grade at draft</option></select></label></div>
    <div className="grid gap-2 sm:grid-cols-3">{[["Best pick",awards(best)],["Worst pick",awards(worst)],["Most F selections",maxF ? managers.filter(m=>m.fs===maxF).map(m=>m.name).join(" · ")+` (${maxF})` : "None"]].map(([label,v])=><div key={label} className={box+" p-3"}><h3 className={'text-xs font-semibold '+muted}>{label}</h3><p className="mt-1 font-semibold">{v}</p></div>)}</div>
    <div className={box+" overflow-hidden"}><table className="w-full text-left text-sm"><caption className="p-3 text-left font-semibold">Best to worst by average score</caption><thead className="bg-[var(--surface-muted)] text-xs"><tr>{["Manager","Graded / picks","Avg / 100","Fs"].map(c=><th key={c} className="p-2 sm:p-3">{c}</th>)}</tr></thead>
      <tbody>{managers.map(m=><tr key={m.owner} className="border-t border-[var(--border)]"><th className="break-all p-2 text-left font-semibold sm:p-3">{m.name}</th><td className="p-2">{m.graded} / {m.count}</td><td className="p-2 font-bold">{m.average?.toFixed(1) ?? "—"}</td><td className="p-2">{m.fs}</td></tr>)}</tbody></table></div>
    <div className="grid gap-3 sm:grid-cols-2">{[["Best drafter by year",years.map(y=>[String(y),leaders(picks.filter(p=>p.year===y),lens)])],["Best drafter by rookie round",rounds.map(r=>["Round "+r,leaders(rookie.filter(p=>p.round===r),lens)])]].map(([title,items])=><div key={String(title)} className={box+" p-4"}><h3 className="font-bold">{String(title)}</h3><p className={'mb-2 text-xs '+muted}>By average score · graded picks in parentheses</p>{(items as string[][]).length===0 && <p className={muted}>No rookie rounds in this season.</p>}{(items as string[][]).map(([key,val])=><div key={key} className="grid grid-cols-[4.25rem_1fr] gap-2 border-t border-[var(--border)] py-2 text-sm"><strong>{key}</strong><span>{val}</span></div>)}</div>)}</div>
  </section>;
}

function PickCard({p,today}:{p:GradedPick;today:string}) {
  return <article className={box+" p-3 sm:p-4"}>
    <p className={'text-xs font-semibold '+muted}>{p.year} · {p.auction ? "Startup auction" : "Pick"} {pickLabel(p)} · {p.pos}</p>
    <h3 className="mt-1 text-lg font-bold">{p.profile ? <a className="hover:underline" href={p.profile}>{p.name}</a> : p.name}</h3>
    <p className={'mb-3 text-sm '+muted}>Picked by <strong>{p.manager ?? "Unknown selector"}</strong>{p.team && p.team!==p.manager ? " · "+p.team : ""}</p>
    <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-[var(--border)]">
      {([["At draft",p.entry,p.at],["Now",p.outcome,p.current]] as const).map(([title,g,quote])=><div key={title} className="min-w-0 border-r border-[var(--border)] bg-[var(--surface-muted)] p-2 last:border-0 sm:p-3">
        <div className={'text-xs font-semibold '+muted}>{title}</div><div className="my-1 flex items-center gap-2"><Badge g={g}/><span className="text-sm">{g ? g.score+"/100" : "Unrated"}</span></div>
        <p className="text-sm font-semibold">{quote ? format(quote.value)+" KTC" : "KTC unavailable"}</p><p className={'text-xs '+muted}>{quote?.date ?? (title==="Now" && g ? "Production only" : "No dated quote")}</p></div>)}
    </div>
    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className={'text-xs '+muted}>KTC at two years</dt><dd className="font-semibold">{p.two ? format(p.two.value) : p.due>today ? "Not due yet" : "Unavailable"}</dd><dd className={'text-xs '+muted}>{p.two ? (p.two.date!==p.due ? "Approx. · " : "")+p.two.date : (p.due>today ? "Due " : "Target ")+p.due}</dd></div>
      <div><dt className={'text-xs '+muted}>Fantasy points / game</dt><dd className="font-semibold">{p.games ? (p.points/p.games).toFixed(2) : "—"}</dd><dd className={'text-xs '+muted}>{format(p.games)} games since draft</dd></div></dl>
  </article>;
}

export default function DraftGradesBoard({rows,checked,today}:{rows:GradedPick[];checked:string;today:string}) {
  const [year,setYear]=useState("all"),[owner,setOwner]=useState("all"),[search,setSearch]=useState(""),[order,setOrder]=useState("board"),[page,setPage]=useState(0),[lens,setLens]=useState<Lens>("outcome");
  const seasons=[...new Set(rows.map(p=>p.year))].sort((a,b)=>b-a);
  const season=useMemo(()=>rows.filter(p=>year==="all" || p.year===Number(year)),[rows,year]);
  const managers=rankManagers(season,"outcome").sort((a,b)=>a.name.localeCompare(b.name));
  const filtered=useMemo(()=>{
    const list=season.filter(p=>(owner==="all" || p.owner===owner) && p.name.toLowerCase().includes(search.trim().toLowerCase()));
    const metric=(p:GradedPick)=>order==="ppg" ? p.games ? p.points/p.games : null : (order.startsWith("entry") ? p.entry : p.outcome)?.edge ?? null;
    return list.sort((a,b)=>{
      if(order!=="board") {
        const x=metric(a),y=metric(b);
        if(x!==y) return x===null ? 1 : y===null ? -1 : order.endsWith("asc") ? x-y : y-x;
      }
      return b.year-a.year || a.overall-b.overall;
    });
  },[season,owner,search,order]);
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE));
  return <div className="space-y-6"><header className="space-y-2"><h1 className="text-3xl font-bold tracking-tight">Draft Grades</h1>
    <p className={muted}>{rows.length} selections since {seasons.at(-1)}. Follow each player from draft day through today, credited to the manager who selected him.</p>
    <a href="#draft-leaders" className="inline-block py-1 font-semibold text-[var(--info)] underline">See drafter leaderboard ↓</a></header>
    <details className={box+" p-3 text-sm"}><summary className="cursor-pointer font-semibold">How grades, KTC values and fantasy points work</summary><div className={'mt-2 max-w-3xl space-y-2 '+muted}>
      <p>Each pick starts at 80/100 for meeting its cost. We rank the selections within their draft by slot, or by winning bid in an auction. Every percentile point a player beats or misses that expectation adds or subtracts one score point. Ties share a rank. Grades start at 90 for A, 80 for B, 70 for C and 60 for D.</p>
      <p>At draft compares Superflex KTC values from the day before the draft opened, looking back up to seven days. Now gives equal weight to current KTC rank and total fantasy points scored since selection. If one measure is unavailable, the other carries the grade. Market comparisons include only selections with a dated price. Scores cap at 0 and 100. Best and worst picks use the uncapped difference.</p>
      <p>Two-year values use the anniversary or the closest earlier quote within 14 days. Every market value shows its source date. A reported zero is shown as 0. A missing price is shown as unavailable.</p>
      <p>Points use each season’s league scoring across regular-season games played, including time on other fantasy rosters. PPG divides total points by Sleeper games played. Season team names and selectors come from Sleeper’s league and draft records. Production checked {checked}.</p>
      <p><a className="underline" href="https://docs.sleeper.com/#get-all-picks-in-a-draft">Sleeper draft records</a> · <a className="underline" href="https://docs.google.com/spreadsheets/d/1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs/edit#gid=991742784">Historical Superflex archive</a></p>
    </div></details>
    <section aria-label="Draft selections" className="space-y-3"><div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <label className="text-xs">Season<select className={control} value={year} onChange={e=>{setYear(e.target.value);setOwner("all");setPage(0)}}><option value="all">All seasons</option>{seasons.map(y=><option key={y}>{y}</option>)}</select></label>
      <label className="text-xs">Selecting manager<select className={control} value={owner} onChange={e=>{setOwner(e.target.value);setPage(0)}}><option value="all">All managers</option>{managers.map(m=><option key={m.owner} value={m.owner}>{m.name}</option>)}</select></label>
      <label className="text-xs">Order by<select className={control} value={order} onChange={e=>{setOrder(e.target.value);setPage(0)}}>{[["board","Draft order"],["entry-desc","Best at draft"],["entry-asc","Worst at draft"],["outcome-desc","Best now"],["outcome-asc","Worst now"],["ppg","Highest PPG"]].map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
      <label className="text-xs">Player<input type="search" className={control} placeholder="Search players" value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}}/></label></div>
      <p aria-live="polite" className={'text-sm '+muted}>{filtered.length ? `${page*PAGE+1}–${Math.min(filtered.length,(page+1)*PAGE)} of ${filtered.length} selections` : "No selections match these filters."}</p>
      <div className="grid gap-3 md:grid-cols-2">{filtered.slice(page*PAGE,(page+1)*PAGE).map(p=><PickCard key={p.id} p={p} today={today}/>)}</div>
      {pages>1 && <nav aria-label="Draft selection pages" className="flex items-center justify-center gap-4 text-sm"><button className="min-h-11 px-2 disabled:opacity-40" disabled={page===0} onClick={()=>setPage(page-1)}>← Previous</button><span>{page+1} / {pages}</span><button className="min-h-11 px-2 disabled:opacity-40" disabled={page+1>=pages} onClick={()=>setPage(page+1)}>Next →</button></nav>}
    </section><Leaderboards picks={season} lens={lens} setLens={setLens}/></div>;
}
