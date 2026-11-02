"use client";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDateEastern, formatPoints, formatSigned } from "@/lib/format";

interface Point { value: number; observedAt: string; validationStatus: string; }
const WINDOWS = [{ label: "30D", days: 30 }, { label: "90D", days: 90 }, { label: "1Y", days: 365 }, { label: "All", days: null as number | null }];
function easternDay(iso: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); }
function dedupe(points: Point[]) { const result: Point[] = []; for (const point of points) if (result.at(-1)?.value !== point.value) result.push(point); return result; }
function dailyClose(points: Point[]) { const days = new Map<string, Point>(); for (const point of points) days.set(easternDay(point.observedAt), point); return [...days.values()]; }

export default function KtcHistoryChart({ points }: { points: Point[] }) {
  const [windowDays, setWindowDays] = useState<number | null>(90);
  const [mode, setMode] = useState<"daily" | "raw">("daily");
  const filtered = useMemo(() => {
    const valid = points.filter(point => point.validationStatus === "VALID" && Number.isFinite(point.value) && point.value > 0 && Number.isFinite(Date.parse(point.observedAt))).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    const cleaned = mode === "daily" ? dailyClose(valid) : dedupe(valid);
    if (windowDays === null || !cleaned.length) return cleaned;
    const cutoff = Date.parse(cleaned[cleaned.length - 1].observedAt) - windowDays * 86400000;
    return cleaned.filter(point => Date.parse(point.observedAt) >= cutoff);
  }, [points, windowDays, mode]);
  const chartData = filtered.map(point => ({ ts: Date.parse(point.observedAt), value: point.value }));
  const first = filtered[0], last = filtered.at(-1);
  const delta = first && last && filtered.length >= 2 ? last.value - first.value : null;
  if (points.filter(point => point.validationStatus === "VALID" && Number.isFinite(point.value) && point.value > 0).length < 2) return <p className="text-sm text-neutral-500">Not enough validated observations yet for a chart.</p>;
  return <div className="market-chart">
    <div className="market-chart-toolbar"><div className="market-chart-windows" role="group" aria-label="Chart period">{WINDOWS.map(item => <button type="button" key={item.label} aria-pressed={windowDays === item.days} onClick={() => setWindowDays(item.days)} className={windowDays === item.days ? "active" : ""}>{item.label}</button>)}</div><div className="market-chart-windows" role="group" aria-label="Chart data mode"><button type="button" aria-pressed={mode === "daily"} className={mode === "daily" ? "active" : ""} onClick={() => setMode("daily")}>Daily close</button><button type="button" aria-pressed={mode === "raw"} className={mode === "raw" ? "active" : ""} onClick={() => setMode("raw")}>Price changes</button></div></div>
    <div className="market-chart-summary"><div><strong>{last ? formatPoints(last.value) : "—"}</strong><span>market points · latest {last ? formatDateEastern(last.observedAt) : "unavailable"}</span></div><div className={delta === null ? "" : delta >= 0 ? "positive" : "negative"}>{delta === null ? "No comparable change" : formatSigned(delta) + " pts in view"}</div></div>
    {chartData.length >= 2 ? <div key={String(windowDays) + mode} className="market-chart-plot"><ResponsiveContainer width="100%" height={260}><LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}><CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" /><XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} minTickGap={30} tickFormatter={value => new Date(Number(value)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })} /><YAxis tick={{ fontSize: 11, fill: "var(--chart-tick)" }} domain={["auto", "auto"]} /><Tooltip labelFormatter={value => new Date(Number(value)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })} formatter={value => [formatPoints(Number(value)) + " market points", "Value"]} contentStyle={{ background: "var(--surface)", color: "var(--foreground)", border: "1px solid var(--border-strong)", borderRadius: 8, fontSize: 13 }} labelStyle={{ color: "var(--foreground)" }} /><Line type="monotone" dataKey="value" stroke="var(--positive)" strokeWidth={2.5} dot={false} activeDot={{ r: 6 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></div> : <p className="market-chart-plot market-chart-empty">There are not two validated observations in this period. Choose a longer view.</p>}
    <p className="market-chart-note">Daily close shows the latest validated price for each Eastern day. Price changes removes repeated unchanged fetches. Touch or hover the line for a dated value.</p>
  </div>;
}
