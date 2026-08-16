import { NextResponse } from "next/server";
import { DISPLAY_TIMEZONE } from "@/lib/config";
import { getLatestRefreshRun, startRefresh } from "@/lib/refresh";

export const runtime = "nodejs";
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
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}

export async function GET(request: Request) {
  // This endpoint intentionally does not share CRON_SECRET with GitHub. It is
  // tightly constrained instead: only the repository scheduler header is
  // accepted, only the morning recovery window is allowed, and at most one
  // scheduled refresh can start per Eastern calendar day.
  if (request.headers.get("x-patch14-scheduler") !== "github-actions") {
    return NextResponse.json({ error: "Unauthorized scheduler" }, { status: 401 });
  }

  const now = new Date();
  const local = easternParts(now);
  if (local.hour < 8 || local.hour > 10) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `Outside Patch 14 morning recovery window (${local.hour}:00 Eastern)`,
    });
  }

  const latest = await getLatestRefreshRun();
  if (latest?.startedAt) {
    const latestLocal = easternParts(new Date(latest.startedAt));
    if (latestLocal.date === local.date && latestLocal.hour >= 8) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "Patch 14 scheduled refresh already started today",
        runId: latest.runId,
      });
    }
  }

  try {
    const { runId } = await startRefresh();
    return NextResponse.json({
      ok: true,
      runId,
      scheduledFor: "08:00 America/New_York",
      recoveryWindow: "08:00–10:59 America/New_York",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already in progress/i.test(message)) {
      return NextResponse.json({ ok: true, skipped: true, reason: message });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
