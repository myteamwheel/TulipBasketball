import { NextRequest, NextResponse } from "next/server";
import { repairCurrentOwnershipIntegrity } from "@/lib/ownershipIntegrity";
import { getLatestSuccessfulRefreshRun, startRefresh } from "@/lib/refresh";
import { DISPLAY_TIMEZONE } from "@/lib/config";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) return request.headers.get("authorization") === `Bearer ${secret}`;
  // Compatibility fallback for projects that have not yet provisioned
  // CRON_SECRET. Exact Vercel cron UA is accepted only together with the
  // time-window and once-per-day guards below.
  return request.headers.get("user-agent") === "vercel-cron/1.0";
}

function easternParts(date: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slot: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { slot } = await params;
  if (slot !== "12" && slot !== "13") return NextResponse.json({ error: "Unknown cron slot" }, { status: 404 });

  const now = new Date();
  const local = easternParts(now);
  // Vercel schedules in UTC. Two daily UTC slots cover EDT and EST; only the
  // slot landing inside the 8 a.m. Eastern hour performs work.
  if (local.hour !== 8) {
    return NextResponse.json({ ok: true, skipped: true, reason: "outside_8am_eastern_window", slot, observedHour: local.hour });
  }

  const latestSuccess = await getLatestSuccessfulRefreshRun();
  if (latestSuccess?.startedAt && easternParts(new Date(latestSuccess.startedAt)).date === local.date) {
    return NextResponse.json({ ok: true, skipped: true, reason: "daily_refresh_already_completed", slot, runId: latestSuccess.runId });
  }

  try {
    await repairCurrentOwnershipIntegrity();
    const { runId } = await startRefresh();
    return NextResponse.json({ ok: true, runId, slot, scheduledFor: "08:00 America/New_York" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already in progress/i.test(message)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "refresh_already_running", slot });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
