import { NextResponse } from "next/server";
import { getPrimaryManager, getCurrentRoster } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { getLatestMarketSourceStatuses, getCurrentMarketMix } from "@/lib/marketSources";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import { getMarketMovers } from "@/lib/marketMovers";
import { getTrustedMarketContext } from "@/lib/trustedMarketContext";

export const dynamic = "force-dynamic";

function safeMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database-url-redacted]")
    .replace(/npg_[A-Za-z0-9]+/g, "[credential-redacted]")
    .slice(0, 800);
}

export async function GET() {
  const results: Array<{ step: string; ok: boolean; message?: string }> = [];
  let playerIds: string[] = [];
  try {
    const manager = await getPrimaryManager();
    if (!manager) throw new Error("Primary manager missing");
    const roster = await getCurrentRoster(manager.id);
    playerIds = roster.map((p) => p.id);
    results.push({ step: "roster", ok: true, message: `${playerIds.length} players` });
  } catch (err) {
    results.push({ step: "roster", ok: false, message: safeMessage(err) });
    return NextResponse.json({ ok: false, results });
  }

  const tests: Array<[string, () => Promise<unknown>]> = [
    ["marketData", () => computeMarketDataForPlayers(playerIds)],
    ["marketMix", () => getCurrentMarketMix(playerIds)],
    ["sourceStatuses", () => getLatestMarketSourceStatuses()],
    ["signals", () => computeSignalsForCurrentRoster()],
    ["marketMovers", () => getMarketMovers(playerIds)],
    ["trustedMarkets", () => getTrustedMarketContext(playerIds)],
  ];
  for (const [step, fn] of tests) {
    try {
      await fn();
      results.push({ step, ok: true });
    } catch (err) {
      results.push({ step, ok: false, message: safeMessage(err) });
    }
  }
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
