import TradeFinderBoard from "@/components/TradeFinderBoard";
import StrategyManager from "@/components/StrategyManager";
import { buildTradeFinderData } from "@/lib/tradeFinder";

export const dynamic = "force-dynamic";

export default async function TradeFinderPage() {
  const data = await buildTradeFinderData();
  if (!data) return <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-6 text-sm text-amber-200">Orlando Oswalds has not been resolved yet. Refresh Sleeper data first.</div>;
  return <div className="min-w-0 space-y-6"><div><h1 className="text-xl font-semibold text-neutral-100">Trade Lab</h1><p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">League-aware targets and a manual calculator using current Sleeper ownership, fresh KTC-anchored values, verified draft picks and your saved strategy preferences.</p></div><StrategyManager assets={data.calculatorAssets} primaryManagerId={data.primaryManagerId} initial={data.strategies}/><TradeFinderBoard data={data}/></div>;
}
