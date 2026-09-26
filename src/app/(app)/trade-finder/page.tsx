import TradeFinderBoard from "@/components/TradeFinderBoard";
import { getTradeFinderData } from "@/lib/tradeFinder";

export const dynamic = "force-dynamic";

export default async function TradeFinderPage() {
  const data = await getTradeFinderData();
  if (!data) return <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-6 text-sm text-amber-200">Orlando Oswalds has not been resolved yet. The next scheduled Sleeper sync will retry.</div>;
  return <div className="min-w-0 space-y-6"><div><h1 className="text-xl font-semibold text-neutral-100">Trade Lab</h1><p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">League-aware targets with roster-space and team-motive checks. Suggestions computed {new Date(data.computedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}.</p></div><TradeFinderBoard data={data}/></div>;
}
