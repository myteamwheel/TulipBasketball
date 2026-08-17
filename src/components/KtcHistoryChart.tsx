"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Point { value: number; observedAt: string; validationStatus: string; }
const WINDOWS = [{ label: "30D", days: 30 }, { label: "90D", days: 90 }, { label: "1Y", days: 365 }, { label: "All", days: null as number | null }];
function easternDay(iso:string){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso));}
function dedupeConsecutive(points:Point[]){const out:Point[]=[];for(const point of points){const last=out.at(-1);if(!last||last.value!==point.value)out.push(point);}return out;}
function dailyClose(points:Point[]){const byDay=new Map<string,Point>();for(const point of points)byDay.set(easternDay(point.observedAt),point);return [...byDay.values()];}

export default function KtcHistoryChart({ points }: { points: Point[] }) {
  const [windowDays, setWindowDays] = useState<number | null>(90);
  const [mode,setMode]=useState<"daily"|"raw">("daily");
  const filtered = useMemo(() => {
    const valid = points.filter((point) => point.validationStatus === "VALID").sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
    const cleaned=mode==="daily"?dailyClose(valid):dedupeConsecutive(valid);
    if (windowDays === null || cleaned.length === 0) return cleaned;
    const latest = new Date(cleaned[cleaned.length - 1].observedAt).getTime();
    const cutoff = latest - windowDays * 86400000;
    return cleaned.filter((point) => new Date(point.observedAt).getTime() >= cutoff);
  }, [points, windowDays,mode]);
  const chartData = filtered.map((point) => ({ ts: new Date(point.observedAt).getTime(), value: point.value, observedAt: point.observedAt }));
  if (points.filter((point) => point.validationStatus === "VALID").length < 2) return <p className="text-sm text-neutral-500">Not enough validated observations yet for a chart.</p>;
  return <div>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex gap-1">{WINDOWS.map((window) => <button key={window.label} onClick={() => setWindowDays(window.days)} className={`rounded-md px-2.5 py-1 text-xs ${windowDays === window.days ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"}`}>{window.label}</button>)}</div><div className="flex rounded-md border border-neutral-800 bg-neutral-950 p-0.5"><button onClick={()=>setMode("daily")} className={`rounded px-2 py-1 text-[10px] ${mode==="daily"?"bg-neutral-700 text-neutral-100":"text-neutral-500"}`}>Daily close</button><button onClick={()=>setMode("raw")} className={`rounded px-2 py-1 text-[10px] ${mode==="raw"?"bg-neutral-700 text-neutral-100":"text-neutral-500"}`}>Price changes</button></div></div>
    <ResponsiveContainer width="100%" height={260}><LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}><CartesianGrid stroke="#262626" strokeDasharray="3 3"/><XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={{ fontSize: 10, fill: "#737373" }} minTickGap={30} tickFormatter={(value) => new Date(Number(value)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone:"America/New_York" })}/><YAxis tick={{ fontSize: 10, fill: "#737373" }} domain={["auto", "auto"]}/><Tooltip labelFormatter={(value) => new Date(Number(value)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone:"America/New_York" })} contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "#a3a3a3" }}/><Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer>
    <p className="mt-2 text-[9px] text-neutral-700">Daily close keeps the latest validated observation for each Eastern day. Price changes removes repeated unchanged fetches so refresh heartbeats do not masquerade as market movement.</p>
  </div>;
}
