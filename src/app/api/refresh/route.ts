import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { startRefresh, getLatestRefreshRun } from "@/lib/refresh";
import { AUTO_REFRESH_ON_VISIT, DYNASTY_DEALER_REFRESH_ENABLED, FANTASYCALC_REFRESH_ENABLED, KTC_DIRECT_REFRESH_ENABLED, MARKET_SOURCE_MAX_AGE_HOURS, STATSGUY_REFRESH_ENABLED, TRADYR_REFRESH_ENABLED } from "@/lib/config";

export const maxDuration = 300;

export async function POST() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const { runId } = await startRefresh(); return NextResponse.json({ runId }); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to start refresh" }, { status: 409 }); }
}
export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const run = await getLatestRefreshRun();
  return NextResponse.json({ run, capabilities: {
    autoRefreshOnVisit: AUTO_REFRESH_ON_VISIT,
    ktcAutoRefreshEnabled: KTC_DIRECT_REFRESH_ENABLED,
    ktcMode: KTC_DIRECT_REFRESH_ENABLED ? "direct-public-page" : "manual-import",
    sources: { KTC: KTC_DIRECT_REFRESH_ENABLED, TRADYR: TRADYR_REFRESH_ENABLED, DYNASTY_DEALER: DYNASTY_DEALER_REFRESH_ENABLED, FANTASYCALC_DIAGNOSTIC: FANTASYCALC_REFRESH_ENABLED, STATSGUY_DIAGNOSTIC: STATSGUY_REFRESH_ENABLED },
    freshnessHours: MARKET_SOURCE_MAX_AGE_HOURS,
  }});
}
