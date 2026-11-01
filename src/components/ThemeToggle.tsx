"use client";

import { useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";
const STORAGE_KEY = "dynasty-theme";
const CHANGE_EVENT = "dynasty-theme-change";
let temporaryPreference: Theme | null = null;

function preference(): Theme {
  if (temporaryPreference) return temporaryPreference;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "dark" || saved === "light" ? saved : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const sync = () => {
    applyTheme(preference());
    onChange();
  };
  media.addEventListener("change", sync);
  window.addEventListener("storage", sync);
  window.addEventListener(CHANGE_EVENT, sync);
  sync();
  return () => {
    media.removeEventListener("change", sync);
    window.removeEventListener("storage", sync);
    window.removeEventListener(CHANGE_EVENT, sync);
  };
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, preference, () => "system" as const);
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-400">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></svg>
      <span className="sr-only">Color theme</span>
      <select
        aria-label="Color theme"
        value={theme}
        onChange={(event) => {
          const next = event.target.value as Theme;
          applyTheme(next);
          try {
            localStorage.setItem(STORAGE_KEY, next);
            temporaryPreference = null;
          } catch {
            temporaryPreference = next;
          }
          window.dispatchEvent(new Event(CHANGE_EVENT));
        }}
        className="min-h-11 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-200"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
