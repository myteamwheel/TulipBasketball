import Link from "next/link";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations } from "@/lib/teamMetrics";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";
import RiserFallerTabs, { type MoverRow } from "@/components/RiserFallerTabs";
import SectionHeader from "@/components/SectionHeader";
import { formatPercent, formatPoints, formatSigned, trendColorClass } from "@/lib/format";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function hasMeaningfulRange(sparkline: { value: number; observedAt: string }[]) {
  if (sparkline.length < 3) return false;
  const first = new Date(sparkline[0].observedAt).getTime();
  const last = new Date(sparkline[sparkline.length - 1].observedAt).getTime();
  return Number.isFinite(first) && Number.isFinite(last) && last - first >= 14 * DAY_MS;
}

export default async function LeaguePage() {
  const entries = await getAllCurrentRosterEntries();
  const playerIds = entries.map((e) => e.playerId);
  const [marketData, marketMix, valuations] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    getFreshCurrentMarketMix(playerIds),
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

  const rangeEligible = entries
    .map((e) => ({ e, m: marketData.get(e.playerId)! }))
    .filter(({ m }) => m.distanceFromHigh !== null && hasMeaningfulRange(m.sparkline));

  const nearHigh = [...rangeEligible]
    .sort((a, b) => (b.m.distanceFromHigh?.percent ?? -999) - (a.m.distanceFromHigh?.percent ?? -999))
    .slice(0, 8);

  const largestDrawdowns = [...rangeEligible]
    .filter(({ m }) => (m.distanceFromHigh?.percent ?? 0) < 0)
    .sort((a, b) => (a.m.distanceFromHigh?.percent ?? 0) - (b.m.distanceFromHigh?.percent ?? 0))
    .slice(0, 8);

  const rankedByTotal = [...valuations].sort((a, b) => b.totalValue - a.totalValue);
  const rankedByStarter = [...valuations].sort((a, b) => b.starterValue - a.starterValue);
  const rankedByDepth = [...valuations].sort((a, b) => b.benchValue - a.benchValue);
  const totalRank = new Map(rankedByTotal.map((v, i) => [v.managerId, i + 1]));
  const starterRank = new Map(rankedByStarter.map((v, i) => [v.managerId, i + 1]));
  const depthRank = new Map(rankedByDepth.map((v, i) => [v.managerId, i + 1]));
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
    .slice(0, 4);

  const topStarterUnits = rankedByStarter.slice(0, 4);
  const topDepth = rankedByDepth.slice(0, 4);

  return (
    <div className="min-w-0 space-y-7">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">League Market</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
          Current player-value rankings across all Dynasty Boys rosters. Historical windows appear only when a real stored checkpoint exists near that date; missing history is left blank instead of estimated.
        </p>
      </div>

      <section className="min-w-0">
        <SectionHeader title="League movers" description="Latest observation, true 7-day window, or true 30-day window. A player is omitted from a window when there is no valid comparison checkpoint." />
        <RiserFallerTabs rows={moverRows} />
      </section>

      <section className="min-w-0">
        <SectionHeader title="Team value ranking" description="KTC totals are player value only. Fresh consensus coverage is shown separately so a partially covered or stale roster is never presented as a complete comparison." />

        <div className="space-y-2 md:hidden">
          {rankedByTotal.map((v) => {
            const consensus = consensusByManager.get(v.managerId);
            return (
              <div key={v.managerId} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-neutral-100">#{totalRank.get(v.managerId)} · {v.teamName}</div>
                    <div className="mt-0.5 text-[10px] text-neutral-600">{v.valuedPlayerCount}/{v.playerCount} current players valued</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg font-semibold tabular-nums text-neutral-100">{formatPoints(v.totalValue)}</div>
                    <div className="text-[9px] uppercase tracking-wide text-neutral-600">KTC</div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-neutral-950 p-2">
                    <div className="text-[9px] text-neutral-600">Starters</div>
                    <div className="mt-0.5 text-xs font-semibold text-neutral-200">#{starterRank.get(v.managerId)}</div>
                  </div>
                  <div className="rounded-md bg-neutral-950 p-2">
                    <div className="text-[9px] text-neutral-600">Depth</div>
                    <div className="mt-0.5 text-xs font-semibold text-neutral-200">#{depthRank.get(v.managerId)}</div>
                  </div>
                  <div className="rounded-md bg-neutral-950 p-2">
                    <div className="text-[9px] text-neutral-600">7-day</div>
                    <div className={`mt-0.5 text-xs font-semibold ${trendColorClass(v.change7d)}`}>{formatSigned(v.change7d)}</div>
                  </div>
                </div>

                <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-[10px] text-neutral-600">
                  <span className="truncate">Fresh consensus {consensus?.covered ? `${formatPoints(consensus.total)} · ${consensus.covered}/${consensus.rostered}` : "—"}</span>
                  <span className="shrink-0">7d coverage {v.change7dCoverage}/{v.playerCount}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 md:block">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-2 text-left">Rank</th>
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-2 py-2 text-right">KTC total</th>
                <th className="px-2 py-2 text-right">Fresh consensus</th>
                <th className="px-2 py-2 text-right">Starter rank</th>
                <th className="px-2 py-2 text-right">Depth rank</th>
                {positions.map((p) => <th key={p} className="px-2 py-2 text-right">{p}</th>)}
                <th className="px-2 py-2 text-right">7d</th>
              </tr>
            </thead>
            <tbody>
              {rankedByTotal.map((v) => {
                const consensus = consensusByManager.get(v.managerId);
                return (
                  <tr key={v.managerId} className="border-b border-neutral-900 hover:bg-neutral-800/30">
                    <td className="px-3 py-2 text-neutral-500">#{totalRank.get(v.managerId)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-neutral-100">{v.teamName}</div>
                      <div className="text-[9px] text-neutral-600">{v.valuedPlayerCount}/{v.playerCount} valued</div>
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-neutral-100">{formatPoints(v.totalValue)}</td>
                    <td className="px-2 py-2 text-right text-emerald-300">
                      {consensus?.covered ? <><div>{formatPoints(consensus.total)}</div><div className="text-[9px] text-neutral-600">{consensus.covered}/{consensus.rostered}</div></> : "—"}
                    </td>
                    <td className="px-2 py-2 text-right text-neutral-300">#{starterRank.get(v.managerId)}</td>
                    <td className="px-2 py-2 text-right text-neutral-300">#{depthRank.get(v.managerId)}</td>
                    {positions.map((p) => <td key={p} className="px-2 py-2 text-right tabular-nums text-neutral-400">{formatPoints(v.positionalValue[p] ?? 0)}</td>)}
                    <td className={`px-2 py-2 text-right ${trendColorClass(v.change7d)}`}>
                      <div>{formatSigned(v.change7d)}</div>
                      <div className="text-[9px] text-neutral-600">{v.change7dCoverage}/{v.playerCount}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {rangeEligible.length ? (
        <section className="min-w-0">
          <SectionHeader title="Tracked range" description="Only players with at least three observations spanning 14+ days qualify, so a two-point backfill cannot masquerade as a meaningful high/low range." />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
              <h3 className="mb-2 text-xs font-semibold text-neutral-200">Closest to tracked high</h3>
              <ol className="space-y-1.5">
                {nearHigh.map(({ e, m }, i) => (
                  <li key={e.playerId} className="grid min-w-0 grid-cols-[20px_1fr_auto] items-center gap-2 rounded-md bg-neutral-950 px-2.5 py-2 text-xs">
                    <span className="text-right text-[10px] text-neutral-600">{i + 1}</span>
                    <div className="min-w-0">
                      <Link href={`/players/${e.playerId}`} className="block truncate font-medium text-neutral-100 hover:text-emerald-300">{e.player.fullName}</Link>
                      <div className="truncate text-[9px] text-neutral-600">{e.manager.teamName ?? e.manager.displayName}</div>
                    </div>
                    <span className="shrink-0 tabular-nums text-neutral-300">{formatPercent(m.distanceFromHigh?.percent)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
              <h3 className="mb-2 text-xs font-semibold text-neutral-200">Largest drawdown from tracked high</h3>
              <ol className="space-y-1.5">
                {largestDrawdowns.map(({ e, m }, i) => (
                  <li key={e.playerId} className="grid min-w-0 grid-cols-[20px_1fr_auto] items-center gap-2 rounded-md bg-neutral-950 px-2.5 py-2 text-xs">
                    <span className="text-right text-[10px] text-neutral-600">{i + 1}</span>
                    <div className="min-w-0">
                      <Link href={`/players/${e.playerId}`} className="block truncate font-medium text-neutral-100 hover:text-emerald-300">{e.player.fullName}</Link>
                      <div className="truncate text-[9px] text-neutral-600">{e.manager.teamName ?? e.manager.displayName}</div>
                    </div>
                    <span className="shrink-0 tabular-nums text-red-300">{formatPercent(m.distanceFromHigh?.percent)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      ) : null}

      <section className="min-w-0">
        <SectionHeader title="Roster construction" description="Useful structural comparisons instead of ranking teams by raw player count." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
            <h3 className="text-xs font-semibold text-neutral-200">Strongest starting units</h3>
            <ol className="mt-2 space-y-2 text-xs">
              {topStarterUnits.map((v, i) => <li key={v.managerId} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-neutral-300">#{i + 1} {v.teamName}</span><span className="shrink-0 tabular-nums text-neutral-500">{formatPoints(v.starterValue)}</span></li>)}
            </ol>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
            <h3 className="text-xs font-semibold text-neutral-200">Most depth value</h3>
            <ol className="mt-2 space-y-2 text-xs">
              {topDepth.map((v, i) => <li key={v.managerId} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-neutral-300">#{i + 1} {v.teamName}</span><span className="shrink-0 tabular-nums text-neutral-500">{formatPoints(v.benchValue)}</span></li>)}
            </ol>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
            <h3 className="text-xs font-semibold text-neutral-200">Most concentrated</h3>
            <p className="mt-0.5 text-[9px] text-neutral-600">Share of KTC total in top three players.</p>
            <ol className="mt-2 space-y-2 text-xs">
              {mostConcentrated.map((v, i) => <li key={v.managerId} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-neutral-300">#{i + 1} {v.teamName}</span><span className="shrink-0 tabular-nums text-neutral-500">{(v.concentration * 100).toFixed(0)}%</span></li>)}
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
