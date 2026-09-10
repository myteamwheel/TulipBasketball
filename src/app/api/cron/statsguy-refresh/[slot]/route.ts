import { NextRequest, NextResponse } from "next/server";
import { DISPLAY_TIMEZONE } from "@/lib/config";
import { backfillRecentStatsGuyHistory } from "@/lib/statsGuyRecovery";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) return request.headers.get("authorization") === `Bearer ${secret}`;
  return request.headers.get("user-agent") === "vercel-cron/1.0";
}

function easternHour(date: Date): number {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  return Number(value ?? "-1");
}

/**
 * Stats Guy's daily board can publish after the 8 a.m. full refresh. Recheck it
 * during the 10 a.m. Eastern hour so the no-key independent market checkpoint
 * does not age out later in the day. This route never touches KTC identity,
 * Sleeper ownership, strategy writes, or the trusted consensus.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slot: string }> },
) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slot } = await params;
  if (slot !== "14" && slot !== "15") {
    return NextResponse.json({ error: "Unknown cron slot" }, { status: 404 });
  }

  const now = new Date();
  const hour = easternHour(now);
  if (hour !== 10) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "outside_10am_eastern_window",
      slot,
      observedHour: hour,
    });
  }

  try {
    const rows = await backfillRecentStatsGuyHistory(now);
    return NextResponse.json({
      ok: true,
      slot,
      scheduledFor: "10:00 America/New_York",
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
