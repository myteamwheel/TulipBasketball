import { NextResponse } from "next/server";
import { DISPLAY_TIMEZONE } from "@/lib/config";
import { getLatestSuccessfulRefreshRun, startRefresh } from "@/lib/refresh";
import { repairCurrentOwnershipIntegrity } from "@/lib/ownershipIntegrity";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function easternParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Scheduled refresh is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const local = easternParts(now);
  if (local.hour !== 8) return NextResponse.json({ ok: true, skipped: true, reason: "Outside the 8 a.m. ET refresh window" });

  const latestSuccess = await getLatestSuccessfulRefreshRun();
  if (latestSuccess?.startedAt) {
    const prior = easternParts(new Date(latestSuccess.startedAt));
    if (prior.date === local.date && prior.hour === 8) return NextResponse.json({ ok: true, skipped: true, reason: "Daily refresh already completed", runId: latestSuccess.runId });
  }

  try {
    await repairCurrentOwnershipIntegrity();
    const { runId } = await startRefresh();
    return NextResponse.json({ ok: true, runId, scheduledFor: "08:00 America/New_York" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already in progress/i.test(message)) return NextResponse.json({ ok: true, skipped: true, reason: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
