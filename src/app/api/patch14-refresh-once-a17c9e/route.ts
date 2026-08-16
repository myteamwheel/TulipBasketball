import { NextResponse } from "next/server";
import { startRefresh } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const { runId } = await startRefresh();
    return NextResponse.json({ ok: true, patch: 14, runId });
  } catch (error) {
    return NextResponse.json(
      { ok: false, patch: 14, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
