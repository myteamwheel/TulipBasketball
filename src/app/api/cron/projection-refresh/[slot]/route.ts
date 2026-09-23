import { NextRequest, NextResponse } from "next/server";
import { DISPLAY_TIMEZONE } from "@/lib/config";
import {
  recordDailyExportSnapshot,
  refreshWeeklyProjections,
} from "@/lib/weeklyProjection";

export const maxDuration = 180;
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
 * A second daily projection pass catches late injury/role and external-provider
 * updates without rerunning the heavier Sleeper/KTC/football synchronization.
 * The full 8 a.m. refresh remains canonical; this is a projection-only recheck.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slot: string }> },
) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slot } = await params;
  if (slot !== "16" && slot !== "17") {
    return NextResponse.json({ error: "Unknown cron slot" }, { status: 404 });
  }

  const now = new Date();
  const hour = easternHour(now);
  if (hour !== 12) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "outside_noon_eastern_window",
      slot,
      observedHour: hour,
    });
  }

  try {
    const projectionRefresh = await refreshWeeklyProjections(null);
    const healthySource = projectionRefresh.sourceStatuses.some(
      (source) => source.ok && source.rows >= 25,
    );
    const classified =
      projectionRefresh.projected +
      projectionRefresh.excluded +
      projectionRefresh.skippedAlreadyPlayed;
    if (!healthySource || classified === 0) {
      return NextResponse.json(
        {
          ok: false,
          slot,
          scheduledFor: "12:00 America/New_York",
          error: !healthySource
            ? "No healthy external weekly projection source."
            : "Projection refresh classified zero rostered skill players.",
          projectionRefresh,
        },
        { status: 503 },
      );
    }
    const exportSnapshot = await recordDailyExportSnapshot(null);
    return NextResponse.json({
      ok: true,
      slot,
      scheduledFor: "12:00 America/New_York",
      projectionRefresh,
      exportSnapshot,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
