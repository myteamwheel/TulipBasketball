"use client";
import { useSyncExternalStore } from "react";
type Motion = "system" | "full" | "reduced";
const KEY = "dynasty-motion";
const EVENT = "dynasty-motion-change";
let fallback: Motion | null = null;
function getPreference(): Motion {
  if (fallback) return fallback;
  try { const value = localStorage.getItem(KEY); return value === "full" || value === "reduced" ? value : "system"; } catch { return "system"; }
}
function apply(value: Motion) {
  const reduced = value === "reduced" || value === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.dataset.motion = reduced ? "reduced" : "full";
}
function subscribe(callback: () => void) {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const sync = () => { apply(getPreference()); callback(); };
  media.addEventListener("change", sync);
  window.addEventListener("storage", sync);
  window.addEventListener(EVENT, sync);
  sync();
  return () => { media.removeEventListener("change", sync); window.removeEventListener("storage", sync); window.removeEventListener(EVENT, sync); };
}
export default function MotionToggle() {
  const preference = useSyncExternalStore(subscribe, getPreference, () => "system" as const);
  return <label className="flex items-center gap-1.5 text-xs text-neutral-400"><span>Motion</span><select aria-label="Motion preference" value={preference} onChange={event => { const next = event.target.value as Motion; apply(next); try { localStorage.setItem(KEY, next); fallback = null; } catch { fallback = next; } window.dispatchEvent(new Event(EVENT)); }} className="min-h-11 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-200"><option value="system">System</option><option value="full">On</option><option value="reduced">Reduced</option></select></label>;
}
