import { NextResponse } from "next/server";
import { startRefresh, getLatestRefreshRun } from "@/lib/refresh";
import { repairCurrentOwnershipIntegrity } from "@/lib/ownershipIntegrity";
import { DYNASTY_DEALER_REFRESH_ENABLED, KTC_DIRECT_REFRESH_ENABLED, MARKET_SOURCE_MAX_AGE_HOURS, TRADYR_REFRESH_ENABLED } from "@/lib/config";
import { adminDeniedResponse, isAdminRequest } from "@/lib/admin";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return adminDeniedResponse();
  try {
    await repairCurrentOwnershipIntegrity();
    const { runId } = await startRefresh();
    return NextResponse.json({ runId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to start refresh" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET() {
  const run = await getLatestRefreshRun();
  return NextResponse.json({
    run,
    capabilities: {
      publicReadOnly: true,
      manualRefreshAvailable: false,
      autoRefreshOnVisit: false,
      scheduledRefresh: "daily around 8 a.m. ET",
      sources: { KTC: KTC_DIRECT_REFRESH_ENABLED, TRADYR: TRADYR_REFRESH_ENABLED, DYNASTY_DEALER: DYNASTY_DEALER_REFRESH_ENABLED },
      freshnessHours: MARKET_SOURCE_MAX_AGE_HOURS,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
