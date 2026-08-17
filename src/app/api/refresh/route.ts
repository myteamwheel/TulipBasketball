import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { startRefresh, getLatestRefreshRun } from "@/lib/refresh";
import { repairCurrentOwnershipIntegrity } from "@/lib/ownershipIntegrity";
import { DYNASTY_DEALER_REFRESH_ENABLED, KTC_DIRECT_REFRESH_ENABLED, MARKET_SOURCE_MAX_AGE_HOURS, TRADYR_REFRESH_ENABLED } from "@/lib/config";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await repairCurrentOwnershipIntegrity();
    const { runId } = await startRefresh();
    return NextResponse.json({ runId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to start refresh" }, { status: 409 });
  }
}

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const run = await getLatestRefreshRun();
  return NextResponse.json({
    run,
    capabilities: {
      autoRefreshOnVisit: false,
      scheduledRefresh: "daily around 8 a.m. ET",
      sources: { KTC: KTC_DIRECT_REFRESH_ENABLED, TRADYR: TRADYR_REFRESH_ENABLED, DYNASTY_DEALER: DYNASTY_DEALER_REFRESH_ENABLED },
      freshnessHours: MARKET_SOURCE_MAX_AGE_HOURS,
    },
  });
}
