"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ManualRefreshButton() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "starting" | "started" | "error">("idle");
  const [message, setMessage] = useState("");
  async function refresh() {
    setState("starting"); setMessage("");
    try {
      const response = await fetch("/api/admin/refresh", { method: "POST", headers: { "x-admin-key": key } });
      const body = await response.json() as { runId?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to start refresh");
      setState("started"); setMessage("Full dashboard refresh started. This page will update when the run finishes.");
      window.setTimeout(() => router.refresh(), 8_000);
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Unable to start refresh"); }
  }
  return <details className="relative"><summary className="cursor-pointer list-none rounded-md border border-emerald-800 bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-300">Run full update</summary><div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-neutral-700 bg-neutral-950 p-3 shadow-xl"><label className="block text-[10px] text-neutral-400">Owner refresh key<input type="password" value={key} onChange={event => setKey(event.target.value)} placeholder="Enter Vercel CRON_SECRET" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100" /></label><button type="button" onClick={refresh} disabled={!key || state === "starting"} className="mt-2 w-full rounded bg-emerald-900 px-3 py-1.5 text-xs font-medium text-emerald-100 disabled:cursor-not-allowed disabled:opacity-60">{state === "starting" ? "Starting update…" : "Start complete refresh"}</button><p className="mt-2 text-[10px] leading-4 text-neutral-500">Uses the same refresh pipeline and audit validation as the 8 a.m. ET run. Enter the existing CRON_SECRET from Vercel → Settings → Environment Variables. It is sent only to this site and is not saved.</p>{message && <p className={`mt-2 text-[10px] leading-4 ${state === "error" ? "text-red-300" : "text-emerald-300"}`}>{message}</p>}</div></details>;
}
