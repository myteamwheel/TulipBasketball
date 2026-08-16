import Link from "next/link";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations } from "@/lib/teamMetrics";
import { getCurrentMarketMix } from "@/lib/marketSources";
import RiserFallerTabs, { type MoverRow } from "@/components/RiserFallerTabs";
import { formatPercent, formatPoints, formatSigned, trendColorClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LeaguePage() {
  const entries = await getAllCurrentRosterEntries();
  const playerIds = entries.map((e) => e.playerId);
  const [marketData, marketMix, valuations] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    getCurrentMarketMix(playerIds),
    computeAllTeamValuations(),
  ]);

  const consensusByManager = new Map<string, { total: number; covered: number; rostered: number }>();
  for (const e of entries) {
    const current = consensusByManager.get(e.managerId) ?? { total: 0, covered: 0, rostered: 0 };
    current.rostered += 1;
    const value = marketMix.get(e.playerId)?.consensusValue ?? null;
    if (value !== null) {
      current.total += value;
      current.covered += 1;
    }
    consensusByManager.set(e.managerId, current);
  }

  const moverRows: MoverRow[] = entries
    .map((e) => {
      const m = marketData.get(e.playerId)!;
      return {
        id: e.player.id,
        fullName: e.player.fullName,
        position: e.player.position,
        teamName: e.manager.teamName ?? e.manager.displayName,
        currentValue: m.currentValue,
        changeSinceLastRefresh: m.changeSinceLastRefresh?.points ?? null,
        change7dPoints: m.change7d?.points ?? null,
        change30dPoints: m.change30d?.points ?? null,
      };
    })
    .filter((r) => r.currentValue !== null);

  const nearHigh = entries
    .map((e) => ({ e, m: marketData.get(e.playerId)! }))
    .filter(({ m }) => m.distanceFromHigh !== null)
    .sort((a, b) => (b.m.distanceFromHigh?.percent ?? -999) - (a.m.distanceFromHigh?.percent ?? -999))
    .slice(0, 10);

  const largestDrawdowns = entries
    .map((e) => ({ e, m: marketData.get(e.playerId)! }))
    .filter(({ m }) => m.distanceFromHigh !== null)
    .sort((a, b) => (a.m.distanceFromHigh?.percent ?? 0) - (b.m.distanceFromHigh?.percent ?? 0))
    .slice(0, 10);

  const rankedByTotal = [...valuations].sort((a, b) => b.totalValue - a.totalValue);

  const positions = ["QB", "RB", "WR", "TE"];

  const withValue = valuations.filter((v) => v.totalValue > 0);
  const mostConcentrated = [...withValue]
    .map((v) => ({
      ...v,
      concentration:
        entries
          .filter((e) => e.managerId === v.managerId)
          .map((e) => marketData.get(e.playerId)?.currentValue ?? 0)
          .sort((a, b) => b - a)
          .slice(0, 3)
          .reduce((s, x) => s + x, 0) / v.totalValue,
    }))
    .sort((a, b) => b.concentration - a.concentration)
    .slice(0, 3);
  const deepest = [...withValue].sort((a, b) => b.playerCount - a.playerCount).slice(0, 3);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">League Market</h1>
        <p className="text-sm text-neutral-500">Movement and valuation across all 12 Dynasty Boys rosters. Consensus totals require at least two fresh sources per player.</p>
      </div>

      <RiserFallerTabs rows={moverRows} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-100">Nearest Tracked High</h3>
          <ol className="space-y-1.5 text-sm">
            {nearHigh.map(({ e, m }, i) => (
              <li key={e.playerId} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="w-4 text-right text-[11px] text-neutral-600">{i + 1}</span>
                  <Link href={`/players/${e.playerId}`} className="text-neutral-100 hover:text-emerald-400">
                    {e.player.fullName}
                  </Link>
                  <span className="text-[11px] text-neutral-500">{e.manager.teamName ?? e.manager.displayName}</span>
                </span>
                <span className="text-neutral-300">{formatPercent(m.distanceFromHigh?.percent)}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-100">Largest Drawdowns From Peak</h3>
          <ol className="space-y-1.5 text-sm">
            {largestDrawdowns.map(({ e, m }, i) => (
              <li key={e.playerId} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="w-4 text-right text-[11px] text-neutral-600">{i + 1}</span>
                  <Link href={`/players/${e.playerId}`} className="text-neutral-100 hover:text-emerald-400">
                    {e.player.fullName}
                  </Link>
                  <span className="text-[11px] text-neutral-500">{e.manager.teamName ?? e.manager.displayName}</span>
                </span>
                <span className="text-red-400">{formatPercent(m.distanceFromHigh?.percent)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-neutral-100">Team Valuations</h3>
        <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-2 text-left">Rank</th>
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-2 py-2 text-right">KTC Total</th>
                <th className="px-2 py-2 text-right">Consensus</th>
                <th className="px-2 py-2 text-right">Starters</th>
                <th className="px-2 py-2 text-right">Bench/Depth</th>
                {positions.map((p) => (
                  <th key={p} className="px-2 py-2 text-right">
                    {p}
                  </th>
                ))}
                <th className="px-2 py-2 text-right">7d Δ</th>
              </tr>
            </thead>
            <tbody>
              {rankedByTotal.map((v, i) => (
                <tr key={v.managerId} className="border-b border-neutral-900">
                  <td className="px-3 py-2 text-neutral-500">#{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-neutral-100">{v.teamName}</td>
                  <td className="px-2 py-2 text-right font-semibold text-neutral-100">
                    {formatPoints(v.totalValue)}
                  </td>
                  <td className="px-2 py-2 text-right text-emerald-300">
                    {(() => {
                      const c = consensusByManager.get(v.managerId);
                      if (!c || c.covered === 0) return "n/a";
                      return `${formatPoints(c.total)} (${c.covered}/${c.rostered})`;
                    })()}
                  </td>
                  <td className="px-2 py-2 text-right text-neutral-300">{formatPoints(v.starterValue)}</td>
                  <td className="px-2 py-2 text-right text-neutral-300">{formatPoints(v.benchValue)}</td>
                  {positions.map((p) => (
                    <td key={p} className="px-2 py-2 text-right text-neutral-400">
                      {formatPoints(v.positionalValue[p] ?? 0)}
                    </td>
                  ))}
                  <td className={`px-2 py-2 text-right ${trendColorClass(v.change7d)}`}>
                    {formatSigned(v.change7d)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-100">Most Concentrated</h3>
          <p className="mb-2 text-xs text-neutral-500">Share of total value held by top 3 assets.</p>
          <ol className="space-y-1 text-sm">
            {mostConcentrated.map((v) => (
              <li key={v.managerId} className="flex justify-between">
                <span className="text-neutral-100">{v.teamName}</span>
                <span className="text-neutral-400">{(v.concentration * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-100">Deepest Rosters</h3>
          <p className="mb-2 text-xs text-neutral-500">Most valued (mapped) rostered players.</p>
          <ol className="space-y-1 text-sm">
            {deepest.map((v) => (
              <li key={v.managerId} className="flex justify-between">
                <span className="text-neutral-100">{v.teamName}</span>
                <span className="text-neutral-400">{v.playerCount} players</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
