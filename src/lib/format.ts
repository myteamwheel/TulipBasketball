import { DISPLAY_TIMEZONE } from "@/lib/config";

export function formatPoints(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (Math.round(n) || 0).toLocaleString("en-US");
}

export function formatSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Math.round(n) || 0;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "" : "±";
  return `${sign}${rounded.toLocaleString("en-US")}`;
}

export function formatPercent(
  n: number | null | undefined,
  digits = 1,
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Number(n.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}%`;
}

export function formatProbability(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const percent = Math.max(0, Math.min(1, value)) * 100;
  if (percent === 0 || percent === 100) return `${percent}%`;
  if (percent < 1) return "<1%";
  if (percent > 99) return ">99%";
  return `${Math.round(percent)}%`;
}

export function trendColorClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "text-neutral-400";
  return n > 0 ? "text-emerald-400" : "text-red-400";
}

export function formatDateTimeEastern(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

export function formatDateEastern(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 0) {
    const minutes = Math.ceil(-ms / 60000);
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.ceil(minutes / 60);
    return hours < 24 ? `in ${hours}h` : `in ${Math.ceil(hours / 24)}d`;
  }
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
