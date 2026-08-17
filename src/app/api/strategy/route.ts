import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { adminDeniedResponse, isAdminRequest } from "@/lib/admin";
import { getPlayerStrategies, setPlayerStrategy, STRATEGY_STATUSES, type StrategyStatus } from "@/lib/strategy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return adminDeniedResponse();
  const url = new URL(request.url);
  const ids = url.searchParams.getAll("playerId").filter(Boolean);
  const strategies = await getPlayerStrategies(ids.length ? ids : undefined);
  return NextResponse.json({ strategies: Object.fromEntries(strategies) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return adminDeniedResponse();
  const body = await request.json().catch(() => null) as { playerId?: string; status?: string | null } | null;
  const playerId = String(body?.playerId ?? "").trim();
  const requested = body?.status == null || body.status === "" ? null : String(body.status) as StrategyStatus;
  if (!playerId) return NextResponse.json({ error: "playerId is required" }, { status: 400 });
  if (requested !== null && !STRATEGY_STATUSES.includes(requested)) return NextResponse.json({ error: "Invalid strategy status" }, { status: 400 });
  await setPlayerStrategy(playerId, requested);
  revalidatePath("/"); revalidatePath("/trade-finder"); revalidatePath("/players"); revalidatePath(`/players/${playerId}`);
  return NextResponse.json({ ok: true, playerId, status: requested }, { headers: { "Cache-Control": "no-store" } });
}
