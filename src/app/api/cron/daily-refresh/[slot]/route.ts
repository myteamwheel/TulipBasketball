import { NextRequest, NextResponse } from "next/server";
import { repairCurrentOwnershipIntegrity } from "@/lib/ownershipIntegrity";
import { startRefresh } from "@/lib/refresh";
import { DISPLAY_TIMEZONE } from "@/lib/config";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) return request.headers.get("authorization") === `Bearer ${secret}`;
  return request.headers.get("user-agent") === "vercel-cron/1.0";
}

function localHour(date: Date): number {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return Number(value);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slot: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { slot } = await params;
  const now = new Date();
  const hour = localHour(now);

  // Vercel cron schedules are UTC. Production schedules invoke this route at
  // both 12:00 and 13:00 UTC; only the slot that lands in the 8 a.m. Eastern
  // hour performs work, keeping the refresh aligned across DST changes.
  if (hour !== 8) {
    return NextResponse.json({ ok: true, skipped: true, reason: "outside_8am_eastern_window", slot, observedHour: hour });
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
