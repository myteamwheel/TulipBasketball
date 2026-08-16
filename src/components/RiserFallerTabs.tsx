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
  { key: "changeSinceLastRefresh", label: "Latest Δ" },
  { key: "change7dPoints", label: "7 days" },
  { key: "change30dPoints", label: "30 days" },
] as const;

type WindowKey = (typeof WINDOWS)[number]["key"];

function MoverList({ rows, valueKey, positive }: { rows: MoverRow[]; valueKey: WindowKey; positive: boolean }) {
  return (
    <ol className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={r.id} className="grid min-w-0 grid-cols-[20px_1fr_auto] items-center gap-2 rounded-md bg-neutral-950 px-2.5 py-2">
          <span className="text-right text-[10px] text-neutral-600">{i + 1}</span>
          <div className="min-w-0">
            <Link href={`/players/${r.id}`} className="block truncate text-xs font-medium text-neutral-100 hover:text-emerald-300">
              {r.fullName}
            </Link>
            <div className="truncate text-[9px] text-neutral-600">{r.position} · {r.teamName}</div>
          </div>
          <span className={`shrink-0 text-xs font-semibold tabular-nums ${positive ? "text-emerald-300" : "text-red-300"}`}>
            {formatSigned(r[valueKey])}
          </span>
        </li>
      ))}
      {rows.length === 0 ? <li className="rounded-md bg-neutral-950 p-3 text-xs text-neutral-500">No valid comparisons for this window yet.</li> : null}
    </ol>
  );
}

export default function RiserFallerTabs({ rows }: { rows: MoverRow[] }) {
  const [windowKey, setWindowKey] = useState<WindowKey>("changeSinceLastRefresh");

  const withValue = rows.filter((r) => r[windowKey] !== null);
  const risers = [...withValue]
    .filter((r) => (r[windowKey] ?? 0) > 0)
    .sort((a, b) => (b[windowKey] ?? 0) - (a[windowKey] ?? 0))
    .slice(0, 10);
  const fallers = [...withValue]
    .filter((r) => (r[windowKey] ?? 0) < 0)
    .sort((a, b) => (a[windowKey] ?? 0) - (b[windowKey] ?? 0))
    .slice(0, 10);

  return (
    <div className="min-w-0">
      <div className="no-scrollbar mb-3 flex min-w-0 gap-1 overflow-x-auto">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            onClick={() => setWindowKey(w.key)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-[11px] font-medium ${
              windowKey === w.key ? "bg-emerald-700 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            {w.label}
          </button>
        ))}
        <span className="ml-auto hidden self-center text-[10px] text-neutral-600 sm:block">{withValue.length}/{rows.length} comparable</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-emerald-300">Risers</h3>
            <span className="text-[9px] text-neutral-600">{withValue.length}/{rows.length} comparable</span>
          </div>
          <MoverList rows={risers} valueKey={windowKey} positive />
        </div>
        <div className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-red-300">Fallers</h3>
            <span className="text-[9px] text-neutral-600">Zero/flat values omitted</span>
          </div>
          <MoverList rows={fallers} valueKey={windowKey} positive={false} />
        </div>
      </div>
    </div>
  );
}
