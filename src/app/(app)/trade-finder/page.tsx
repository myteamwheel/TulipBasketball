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
        <h1 className="text-xl font-semibold text-neutral-100">Trade Finder</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
          Targets are ranked from current Sleeper ownership, KTC value, valid market movement, positional value, the other manager’s roster construction, and Orlando’s currently owned future picks.
        </p>
        <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-4 text-neutral-500">
          Generated offers are negotiation starting points, not acceptance predictions. Pick values are included only when Sleeper ownership resolves and a current pick market is available; an unknown future slot uses a neutral value for that round rather than pretending the exact draft position is known.
        </div>
      </div>
      <TradeFinderBoard data={data} />
    </div>
  );
}
