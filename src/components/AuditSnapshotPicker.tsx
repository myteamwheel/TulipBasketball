"use client";

import { useMemo, useState } from "react";

type SnapshotOption = {
  id: string;
  date: string;
  label: string;
};

export default function AuditSnapshotPicker({
  options,
  selectedId,
}: {
  options: SnapshotOption[];
  selectedId: string | null;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? options.filter((option) => option.label.toLowerCase().includes(normalized))
      : options;
  }, [options, query]);
  const selected = options.find((option) => option.id === selectedId)?.id ?? "";

  function openSnapshot(id: string) {
    if (id) window.location.assign(`/audit?date=${encodeURIComponent(id)}`);
  }

  return (
    <div className="grid gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(260px,1fr)]">
      <label className="text-[10px] text-neutral-500">
        Search saved audit dates
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a date, time, rank, or value…"
          className="mt-1 h-9 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-200 outline-none focus:border-emerald-800"
        />
      </label>
      <label className="text-[10px] text-neutral-500">
        Choose a populated snapshot
        <select
          aria-label="Choose saved audit snapshot"
          value={selected}
          onChange={(event) => openSnapshot(event.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-200 outline-none focus:border-emerald-800"
        >
          <option value="">Select a saved snapshot…</option>
          {matches.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="sm:col-span-2 text-[10px] text-neutral-600">
        {matches.length} saved {matches.length === 1 ? "snapshot" : "snapshots"} match. Only validated, populated audits appear here.
      </p>
    </div>
  );
}
