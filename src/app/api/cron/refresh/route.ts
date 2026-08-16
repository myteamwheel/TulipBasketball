import { NextResponse } from "next/server";
import { DISPLAY_TIMEZONE } from "@/lib/config";
import { getLatestRefreshRun, startRefresh } from "@/lib/refresh";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function easternParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Vercel schedules in UTC. This endpoint is invoked at both 12:00 and 13:00
  // UTC; exactly one maps to 8 a.m. Eastern depending on daylight-saving time.
  const now = new Date();
  const local = easternParts(now);
  if (local.hour !== 8) {
    return NextResponse.json({ ok: true, skipped: true, reason: `Not 8 a.m. Eastern (${local.hour}:00 local)` });
  }

  const latest = await getLatestRefreshRun();
  if (latest?.startedAt) {
    const latestLocal = easternParts(new Date(latest.startedAt));
    if (latestLocal.date === local.date && latestLocal.hour === 8) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Patch 14 daily refresh already started today", runId: latest.runId });
    }
  }

  try {
    const { runId } = await startRefresh();
    return NextResponse.json({ ok: true, runId, scheduledFor: "08:00 America/New_York" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already in progress/i.test(message)) return NextResponse.json({ ok: true, skipped: true, reason: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
