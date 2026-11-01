"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { monitorRefresh } from "@/lib/refreshMonitor";

export default function ManualRefreshButton() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "starting" | "running" | "success" | "partial" | "error">("idle");
  const [message, setMessage] = useState("");
  const [activeRun, setActiveRun] = useState<{ runId: string; key: string } | null>(null);
  const busy = state === "starting" || state === "running";

  useEffect(() => {
    if (!activeRun) return;
    const controller = new AbortController();
    void monitorRefresh(activeRun.runId, activeRun.key, {
      signal: controller.signal,
      onProgress: () => {},
    }).then(run => {
      if (controller.signal.aborted) return;
      setState(run.status === "SUCCESS" ? "success" : run.status === "PARTIAL_FAILURE" ? "partial" : "error");
      setMessage(run.status === "SUCCESS" ? "Full refresh finished. The dashboard now shows the updated data." : run.status === "PARTIAL_FAILURE" ? "Refresh finished with some source failures. Available data was updated; see Refresh history for details." : "Refresh failed. See Refresh history for details.");
      setActiveRun(null);
      router.refresh();
    }).catch(error => {
      if (controller.signal.aborted) return;
      setState("error");
      setMessage(`${error instanceof Error ? error.message : "Progress checks stopped."} The run may still be active; check Refresh history before retrying.`);
      setActiveRun(null);
    });
    return () => controller.abort();
  }, [activeRun, router]);
  async function refresh() {
    setState("starting"); setMessage("");
    try {
      const response = await fetch("/api/admin/refresh", { method: "POST", headers: { "x-admin-key": key.trim() }, signal: AbortSignal.timeout(30_000) });
      const body = await response.json() as { runId?: string; error?: string };
      if (!response.ok || !body.runId) throw new Error(body.error || "Unable to start refresh");
      setState("running"); setMessage("Full dashboard refresh is running. This page will update when the run finishes.");
      setActiveRun({ runId: body.runId, key: key.trim() });
      setKey("");
    } catch (error) { setState("error"); setMessage(error instanceof Error && error.name === "TimeoutError" ? "The start request timed out. The run may still have started; check Refresh history before retrying." : error instanceof Error ? error.message : "Unable to start refresh"); }
  }
  return <details className="relative"><summary className="cursor-pointer list-none rounded-md border border-emerald-800 bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-300">Run full update</summary><div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-neutral-700 bg-neutral-950 p-3 shadow-xl"><label className="block text-[10px] text-neutral-400">Dashboard refresh key<input type="password" disabled={busy} value={key} onChange={event => setKey(event.target.value)} placeholder="Enter owner refresh key" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100" /></label><button type="button" onClick={refresh} disabled={!key.trim() || busy} className="mt-2 w-full rounded bg-emerald-900 px-3 py-1.5 text-xs font-medium text-emerald-100 disabled:cursor-not-allowed disabled:opacity-60">{state === "running" ? "Refresh in progress…" : state === "starting" ? "Starting update…" : "Start complete refresh"}</button><p className="mt-2 text-[10px] leading-4 text-neutral-500">Uses the same refresh pipeline and audit validation as the 8 a.m. ET run. Use your dedicated dashboard refresh key; it is sent only to this site and is not saved.</p>{message && <p role="status" aria-live="polite" className={`mt-2 text-[10px] leading-4 ${state === "error" ? "text-red-300" : state === "partial" ? "text-amber-300" : "text-emerald-300"}`}>{message}</p>}{message && <Link href="/refresh-history" className="mt-2 inline-block text-xs text-emerald-300 underline">Refresh history →</Link>}</div></details>;
}
