"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { WaiverMarketRow } from "@/lib/waiverMarket";

const POINTS_FOR_THIS_WEEK = 7;
const PAGE_SIZE = 25;

const points = (value: number | null) =>
  value == null ? "—" : value.toFixed(1);
const signed = (value: number | null) =>
  value == null
    ? "—"
    : `${value > 0 ? "+" : value < 0 ? "" : "±"}${Math.round(value).toLocaleString("en-US")}`;

function isActionableThisWeek(row: WaiverMarketRow) {
  return (
    !row.isKickoffLocked &&
    row.projectedPoints !== null &&
    row.projectedPoints >= POINTS_FOR_THIS_WEEK
  );
}

export default function WaiverMarketBoard({ rows }: { rows: WaiverMarketRow[] }) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [scope, setScope] = useState<"ACTIONABLE" | "ALL">("ACTIONABLE");
  const [sort, setSort] = useState<"value" | "projection" | "move">("projection");
  const [page, setPage] = useState(1);

  const filtered = useMemo(
    () =>
      rows
        .filter((row) => position === "ALL" || row.position === position)
        .filter((row) => scope === "ALL" || isActionableThisWeek(row))
        .filter((row) =>
          `${row.fullName} ${row.nflTeam ?? ""}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
        .sort((a, b) =>
          sort === "projection"
            ? (b.projectedPoints ?? -Infinity) - (a.projectedPoints ?? -Infinity)
            : sort === "move"
              ? (b.latestMove ?? -Infinity) - (a.latestMove ?? -Infinity)
              : b.currentValue - a.currentValue,
        ),
    [rows, position, query, scope, sort],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount);
  const visibleRows = filtered.slice(
    (visiblePage - 1) * PAGE_SIZE,
    visiblePage * PAGE_SIZE,
  );

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <input
          aria-label="Search unrostered players"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            resetPage();
          }}
          placeholder="Search unrostered player…"
          className="h-9 rounded-md border border-neutral-800 bg-neutral-900 px-3 text-xs text-neutral-200"
        />
        <div className="flex rounded-md border border-neutral-800 bg-neutral-900 p-1">
          {["ALL", "QB", "RB", "WR", "TE"].map((value) => (
            <button
              key={value}
              aria-pressed={position === value}
              onClick={() => {
                setPosition(value);
                resetPage();
              }}
              className={`rounded px-2.5 py-1 text-xs ${position === value ? "bg-neutral-700 text-white" : "text-neutral-400"}`}
            >
              {value}
            </button>
          ))}
        </div>
        <select
          aria-label="Sort waiver players"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as typeof sort);
            resetPage();
          }}
          className="h-9 rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs"
        >
          <option value="projection">Highest weekly projection</option>
          <option value="value">Highest KTC</option>
          <option value="move">Latest risers</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-950 p-2">
        <div className="flex gap-1" role="group" aria-label="Waiver candidate scope">
          <button
            aria-pressed={scope === "ACTIONABLE"}
            onClick={() => {
              setScope("ACTIONABLE");
              resetPage();
            }}
            className={`rounded px-2.5 py-1.5 text-xs ${scope === "ACTIONABLE" ? "bg-emerald-700 text-white" : "text-neutral-400"}`}
          >
            Actionable this week
          </button>
          <button
            aria-pressed={scope === "ALL"}
            onClick={() => {
              setScope("ALL");
              resetPage();
            }}
            className={`rounded px-2.5 py-1.5 text-xs ${scope === "ALL" ? "bg-neutral-700 text-white" : "text-neutral-400"}`}
          >
            All verified candidates
          </button>
        </div>
        <p className="text-[11px] text-neutral-500">
          {scope === "ACTIONABLE"
            ? `Showing players with ${POINTS_FOR_THIS_WEEK}+ current projected points. All verified free agents remain available.`
            : "Includes every verified free agent, including players without a usable current-week role."}
        </p>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          {filtered.length.toLocaleString()} matching candidates
          {pageCount > 1 ? ` · page ${visiblePage} of ${pageCount}` : ""}
        </span>
        <span>{rows.length.toLocaleString()} verified free agents total</span>
      </div>

      <div className="space-y-2 md:hidden">
        {visibleRows.map((row) => (
          <Link
            key={row.id}
            href={`/players/${row.id}`}
            className="block rounded-lg border border-neutral-800 bg-neutral-900 p-3"
          >
            <div className="flex justify-between">
              <div>
                <div className="font-medium">{row.fullName}</div>
                <div className="text-xs text-neutral-400">
                  {row.position}
                  {row.nflTeam ? ` · ${row.nflTeam}` : ""} · {row.projectedRole}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-emerald-300">
                  {points(row.projectedPoints)} FP
                </div>
                <div className="text-xs text-neutral-400">
                  KTC {Math.round(row.currentValue)}
                </div>
              </div>
            </div>
            <div className="mt-2 text-xs text-sky-300">
              {row.need} · latest {signed(row.latestMove)}
            </div>
          </Link>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 md:block">
        <table className="w-full min-w-[900px] text-xs">
          <thead>
            <tr className="border-b border-neutral-800 text-xs uppercase text-neutral-400">
              <th className="px-3 py-2 text-left">Player</th>
              <th className="px-2 py-2 text-left">Role</th>
              <th className="px-2 py-2 text-left">Your need</th>
              <th className="px-2 py-2 text-right">Week projection</th>
              <th className="px-2 py-2 text-right">KTC</th>
              <th className="px-2 py-2 text-right">Latest move</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} className="border-b border-neutral-800">
                <td className="px-3 py-2">
                  <Link
                    href={`/players/${row.id}`}
                    className="font-medium text-neutral-100 hover:text-emerald-300"
                  >
                    {row.fullName}
                  </Link>
                  <div className="text-xs text-neutral-400">
                    {row.position}
                    {row.nflTeam ? ` · ${row.nflTeam}` : ""}
                  </div>
                </td>
                <td className="px-2 py-2 text-neutral-300">{row.projectedRole}</td>
                <td className="px-2 py-2 text-sky-300">{row.need}</td>
                <td className="px-2 py-2 text-right font-semibold text-emerald-300">
                  {points(row.projectedPoints)}
                </td>
                <td className="px-2 py-2 text-right">
                  {Math.round(row.currentValue).toLocaleString()}
                </td>
                <td className="px-2 py-2 text-right">{signed(row.latestMove)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!filtered.length ? (
        <div className="rounded-lg border border-neutral-800 p-6 text-center text-xs text-neutral-400">
          No unrostered players match these filters. Try all verified candidates or another position.
        </div>
      ) : null}

      {pageCount > 1 ? (
        <nav aria-label="Waiver candidates pages" className="flex items-center justify-between gap-2">
          <button
            disabled={visiblePage === 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-md border border-neutral-800 px-3 py-2 text-xs text-neutral-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-neutral-500">
            Page {visiblePage} of {pageCount}
          </span>
          <button
            disabled={visiblePage === pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            className="rounded-md border border-neutral-800 px-3 py-2 text-xs text-neutral-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}
