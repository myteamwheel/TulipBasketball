import { NextRequest, NextResponse } from "next/server";
import { DISPLAY_TIMEZONE } from "@/lib/config";
import { repairCurrentOwnershipIntegrity } from "@/lib/ownershipIntegrity";
import { startRefresh } from "@/lib/refresh";
import { backfillRecentStatsGuyHistory } from "@/lib/statsGuyRecovery";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) return request.headers.get("authorization") === `Bearer ${secret}`;
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
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}

/**
 * One guarded recovery run for the Sep. 9, 2026 market-ingestion outage.
 * The Vercel schedule is intentionally date-scoped, and this route refuses to
 * mutate data outside the exact opening-day recovery window even if invoked.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const local = easternParts(now);
  if (local.date !== "2026-09-09" || local.hour < 20 || local.hour > 22) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "outside_opening_day_recovery_window",
      observed: local,
    });
  }

  try {
    await repairCurrentOwnershipIntegrity();
    const statsGuyHistory = await backfillRecentStatsGuyHistory(now);
    const { runId } = await startRefresh();
    return NextResponse.json({
      ok: true,
      runId,
      statsGuyHistory,
      reason: "opening_day_market_recovery",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already in progress/i.test(message)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "refresh_already_running",
        error: message,
      });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
