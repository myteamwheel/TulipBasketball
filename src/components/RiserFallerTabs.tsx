"use client";

import { useState } from "react";
import Link from "next/link";
import { formatSigned } from "@/lib/format";

export interface MoverRow {
  id: string;
  fullName: string;
  position: string;
  teamName: string;
  currentValue: number | null;
  changeSinceLastRefresh: number | null;
  change7dPoints: number | null;
  change30dPoints: number | null;
}

const WINDOWS = [
  { key: "changeSinceLastRefresh", label: "Since Refresh" },
  { key: "change7dPoints", label: "7 Day" },
  { key: "change30dPoints", label: "30 Day" },
] as const;

type WindowKey = (typeof WINDOWS)[number]["key"];

function MoverList({
  rows,
  valueKey,
  positive,
}: {
  rows: MoverRow[];
  valueKey: WindowKey;
  positive: boolean;
}) {
  return (
    <ol className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={r.id} className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <span className="w-4 text-right text-[11px] text-neutral-600">{i + 1}</span>
            <Link href={`/players/${r.id}`} className="text-neutral-100 hover:text-emerald-400">
              {r.fullName}
            </Link>
            <span className="text-[11px] text-neutral-500">
              {r.position} · {r.teamName}
            </span>
          </span>
          <span className={`font-medium ${positive ? "text-emerald-400" : "text-red-400"}`}>
            {formatSigned(r[valueKey])}
          </span>
        </li>
      ))}
      {rows.length === 0 && <li className="text-sm text-neutral-500">No data for this window.</li>}
    </ol>
  );
}

export default function RiserFallerTabs({ rows }: { rows: MoverRow[] }) {
  const [windowKey, setWindowKey] = useState<WindowKey>("changeSinceLastRefresh");

  const withValue = rows.filter((r) => r[windowKey] !== null);
  const risers = [...withValue].sort((a, b) => (b[windowKey] ?? 0) - (a[windowKey] ?? 0)).slice(0, 10);
  const fallers = [...withValue].sort((a, b) => (a[windowKey] ?? 0) - (b[windowKey] ?? 0)).slice(0, 10);

  return (
    <div>
      <div className="mb-3 flex gap-1">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            onClick={() => setWindowKey(w.key)}
            className={`rounded-md px-2.5 py-1 text-xs ${
              windowKey === w.key ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-emerald-400">Top 10 Risers</h3>
          <MoverList rows={risers} valueKey={windowKey} positive />
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-red-400">Top 10 Fallers</h3>
          <MoverList rows={fallers} valueKey={windowKey} positive={false} />
        </div>
      </div>
    </div>
  );
}
