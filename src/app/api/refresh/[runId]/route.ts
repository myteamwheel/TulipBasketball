import { NextResponse } from "next/server";
import { adminDeniedResponse, isAdminRequest } from "@/lib/admin";
import { getRefreshRun } from "@/lib/refresh";

export async function GET(request: Request, ctx: { params: Promise<{ runId: string }> }) {
  if (!isAdminRequest(request)) return adminDeniedResponse();
  const { runId } = await ctx.params;
  const run = await getRefreshRun(runId);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ run }, { headers: { "Cache-Control": "no-store" } });
}
