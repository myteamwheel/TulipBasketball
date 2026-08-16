"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ImportSummary {
  importBatchId: string;
  totalRows: number;
  committed: number;
  flagged: number;
  rejected: number;
  unmatched: number;
  ambiguous: number;
  skippedDuplicates: number;
  results: {
    row: { name: string; position?: string; value: number };
    outcome: string;
    detail: string;
  }[];
}

export default function KtcImportForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ktc/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setSummary(data.summary);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h3 className="mb-1 text-sm font-semibold text-neutral-100">Optional manual KTC fallback</h3>
      <p className="mb-4 text-xs leading-relaxed text-neutral-400">
        You do <strong className="text-neutral-200">not</strong> need to upload KTC data during normal use.
        Every page visit and every <span className="text-neutral-200">Refresh Data</span> run automatically requests the live
        KeepTradeCut Superflex / 0.5 PPR / No TE Premium rankings and stores a new timestamped snapshot.
        This uploader is retained only as an emergency fallback if the live KTC page is temporarily unavailable.
      </p>
      <form onSubmit={handleSubmit} className="flex items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.json"
          required
          className="flex-1 text-xs text-neutral-300 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-xs file:text-neutral-200 hover:file:bg-neutral-700"
        />
        <button
          type="submit"
          disabled={busy}
          className="whitespace-nowrap rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </form>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {summary && (
        <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs">
          <p className="mb-2 font-medium text-neutral-200">
            {summary.totalRows} rows — {summary.committed} committed, {summary.flagged} flagged for review,{" "}
            {summary.rejected} rejected, {summary.unmatched} unmatched, {summary.ambiguous} ambiguous, {summary.skippedDuplicates ?? 0} duplicate retries skipped
          </p>
          {summary.results
            .filter((r) => r.outcome !== "committed")
            .slice(0, 25)
            .map((r, i) => (
              <p key={i} className="text-neutral-500">
                <span
                  className={
                    r.outcome === "flagged"
                      ? "text-amber-400"
                      : r.outcome === "rejected"
                        ? "text-red-400"
                        : "text-neutral-400"
                  }
                >
                  [{r.outcome}]
                </span>{" "}
                {r.row.name} ({r.row.position ?? "?"}) = {r.row.value} — {r.detail}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
