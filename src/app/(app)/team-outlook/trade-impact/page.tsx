import Link from "next/link";
import PredictiveTradeImpact from "@/components/PredictiveTradeImpact";
import { getTradeImpactData } from "@/lib/tradeImpact";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trade Impact · Team Outlook · Dynasty Boys" };

export default async function TradeImpactPage() {
  const data = await getTradeImpactData();
  if (!data) {
    return (
      <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-6 text-sm text-amber-200">
        Orlando Oswalds has not been resolved yet. The next scheduled Sleeper
        sync will retry.
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/team-outlook"
            className="text-xs font-medium text-emerald-400 hover:underline"
          >
            ← Team Outlook
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-100 sm:text-2xl">
            Trade impact
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
            Build a possible deal and see its current value balance, lineup
            impact, one-year value change, and estimated playoff and title-path
            change for Orlando Oswalds.
          </p>
        </div>
        <Link
          href="/trade-finder"
          className="w-fit rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          Browse trade targets →
        </Link>
      </section>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs leading-5 text-neutral-500">
        The simulator evaluates a specific package. Trade Lab is for finding
        targets; Team Outlook is for seeing how a completed hypothetical would
        change your roster and title path. It uses the same current refresh and
        evidence weighting as the league outlook.
      </div>

      <PredictiveTradeImpact {...data} />
    </div>
  );
}
