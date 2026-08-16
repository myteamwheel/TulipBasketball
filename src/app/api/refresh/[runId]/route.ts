import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getRefreshRun } from "@/lib/refresh";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { runId } = await ctx.params;
  const run = await getRefreshRun(runId);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ run });
}
