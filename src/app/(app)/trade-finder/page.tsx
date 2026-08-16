import TradeFinderBoard from "@/components/TradeFinderBoard";
import { buildTradeFinderData } from "@/lib/tradeFinder";

export const dynamic = "force-dynamic";

export default async function TradeFinderPage() {
  const data = await buildTradeFinderData();

  if (!data) {
    return <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-6 text-sm text-amber-200">Orlando Oswalds has not been resolved yet. Refresh Sleeper data first.</div>;
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Trade Lab</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
          Live league-aware targets plus a manual Orlando trade calculator. Player ownership comes from Sleeper; player values use the KTC anchor; future picks appear only when current ownership and a fresh pick market can both be resolved.
        </p>
        <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-4 text-neutral-500">
          The package adjustment prevents raw-sum mistakes in consolidation trades: multiple lesser pieces are discounted relative to a stronger single asset, while liquid draft picks retain more secondary-piece value. It is an auditable dashboard model, not an acceptance probability and not a claim to reproduce KeepTradeCut's proprietary formula exactly.
        </div>
      </div>
      <TradeFinderBoard data={data} />
    </div>
  );
}
