"use client";

import { useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceDot,
} from "recharts";

interface Point {
  value: number;
  observedAt: string;
  validationStatus: string;
}

const WINDOWS = [
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "1Y", days: 365 },
  { label: "All", days: null as number | null },
];

export default function KtcHistoryChart({ points }: { points: Point[] }) {
  const [windowDays, setWindowDays] = useState<number | null>(90);

  const filtered = useMemo(() => {
    if (windowDays === null || points.length === 0) return points;
    // Window relative to the most recent observation (not wall-clock time) so
    // the chart still shows data even if KTC hasn't been re-imported recently.
    const latest = Math.max(...points.map((p) => new Date(p.observedAt).getTime()));
    const cutoff = latest - windowDays * 24 * 60 * 60 * 1000;
    return points.filter((p) => new Date(p.observedAt).getTime() >= cutoff);
  }, [points, windowDays]);

  const chartData = filtered.map((p) => ({
    date: new Date(p.observedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    value: p.value,
    observedAt: p.observedAt,
    flagged: p.validationStatus === "FLAGGED",
  }));

  if (points.length < 2) {
    return <p className="text-sm text-neutral-500">Not enough observations yet for a chart.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex gap-1">
        {WINDOWS.map((w) => (
          <button
            key={w.label}
            onClick={() => setWindowDays(w.days)}
            className={`rounded-md px-2.5 py-1 text-xs ${
              windowDays === w.days
                ? "bg-emerald-600 text-white"
                : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#737373" }} minTickGap={30} />
          <YAxis tick={{ fontSize: 10, fill: "#737373" }} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: "#a3a3a3" }}
          />
          <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2} dot={false} />
          {chartData
            .filter((d) => d.flagged)
            .map((d, i) => (
              <ReferenceDot key={i} x={d.date} y={d.value} r={4} fill="#fbbf24" stroke="none" />
            ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
