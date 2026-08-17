"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Point { value: number; observedAt: string; validationStatus: string; }
const WINDOWS = [{ label: "30D", days: 30 }, { label: "90D", days: 90 }, { label: "1Y", days: 365 }, { label: "All", days: null as number | null }];

export default function KtcHistoryChart({ points }: { points: Point[] }) {
  const [windowDays, setWindowDays] = useState<number | null>(90);
  const filtered = useMemo(() => {
    const valid = points.filter((point) => point.validationStatus === "VALID").sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
    if (windowDays === null || valid.length === 0) return valid;
    const latest = new Date(valid[valid.length - 1].observedAt).getTime();
    const cutoff = latest - windowDays * 86400000;
    return valid.filter((point) => new Date(point.observedAt).getTime() >= cutoff);
  }, [points, windowDays]);
  const chartData = filtered.map((point) => ({ ts: new Date(point.observedAt).getTime(), value: point.value, observedAt: point.observedAt }));
  if (points.filter((point) => point.validationStatus === "VALID").length < 2) return <p className="text-sm text-neutral-500">Not enough validated observations yet for a chart.</p>;
  return <div>
    <div className="mb-3 flex gap-1">{WINDOWS.map((window) => <button key={window.label} onClick={() => setWindowDays(window.days)} className={`rounded-md px-2.5 py-1 text-xs ${windowDays === window.days ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"}`}>{window.label}</button>)}</div>
    <ResponsiveContainer width="100%" height={260}><LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}><CartesianGrid stroke="#262626" strokeDasharray="3 3"/><XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={{ fontSize: 10, fill: "#737373" }} minTickGap={30} tickFormatter={(value) => new Date(Number(value)).toLocaleDateString("en-US", { month: "short", day: "numeric" })}/><YAxis tick={{ fontSize: 10, fill: "#737373" }} domain={["auto", "auto"]}/><Tooltip labelFormatter={(value) => new Date(Number(value)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "#a3a3a3" }}/><Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer>
  </div>;
}
