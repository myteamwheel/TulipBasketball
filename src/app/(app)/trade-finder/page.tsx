import TradeFinderBoard from "@/components/TradeFinderBoard";
import { buildTradeFinderData } from "@/lib/tradeFinder";

export const dynamic = "force-dynamic";

export default async function TradeFinderPage() {
  const data = await buildTradeFinderData();

  if (!data) {
    return <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-6 text-sm text-amber-200">Orlando Oswalds has not been resolved yet. Refresh Sleeper data first.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-neutral-100">Trade Finder v2</h1>
            <p className="mt-1 max-w-3xl text-sm text-neutral-500">League-aware targets for Orlando using current Sleeper ownership, live KTC, market movement, positional need, and the other manager’s roster construction.</p>
          </div>
          <div className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-[10px] leading-4 text-neutral-500">Offers are starting points, not claims that the other manager will accept.<br />Draft picks are not fabricated when a reliable pick value is unavailable.</div>
        </div>
      </div>
      <TradeFinderBoard data={data} />
    </div>
  );
}
