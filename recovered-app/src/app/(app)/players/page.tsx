import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { getCurrentMarketMix } from "@/lib/marketSources";
import { getLatestSlotMap } from "@/lib/teamMetrics";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import PlayerTable, { type PlayerRow } from "@/components/PlayerTable";
import SectionHeader from "@/components/SectionHeader";
import { formatPoints, formatSigned, trendColorClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const [entries, slotMap] = await Promise.all([getAllCurrentRosterEntries(), getLatestSlotMap()]);
  const rosteredPlayerIds = new Set(entries.map((e) => e.playerId));
  const freeAgents = await prisma.player.findMany({
    where: { id: { notIn: Array.from(rosteredPlayerIds) }, ktcId: { not: null } },
  });

  const allIds = [...entries.map((e) => e.playerId), ...freeAgents.map((p) => p.id)];
  const [marketData, marketMix, signals] = await Promise.all([
    computeMarketDataForPlayers(allIds),
    getCurrentMarketMix(allIds),
    computeSignalsForCurrentRoster(),
  ]);

  const rosteredRows: PlayerRow[] = entries.map((e) => {
    const m = marketData.get(e.playerId)!;
    const mix = marketMix.get(e.playerId)!;
    const signal = signals.get(e.playerId)?.result;
    return {
      id: e.player.id, fullName: e.player.fullName, position: e.player.position, nflTeam: e.player.nflTeam, status: e.player.status,
      slot: slotMap.get(`${e.managerId}:${e.playerId}`) ?? "BENCH",
      currentValue: m.currentValue, currentObservedAt: m.currentObservedAt,
      consensusValue: mix.consensusValue, consensusSourceCount: mix.consensusSourceCount, consensusSources: mix.consensusSources,
      fantasyCalcValue: mix.fantasyCalcValue, fantasyCalcRawValue: mix.fantasyCalcRawValue,
      statsGuyValue: mix.statsGuyValue, statsGuyRawValue: mix.statsGuyRawValue,
      isStale: m.isStale, pendingReview: m.pendingReview,
      changeSinceLastRefresh: m.changeSinceLastRefresh?.points ?? null,
      change7dPoints: m.change7d?.points ?? null, change7dPercent: m.change7d?.percent ?? null,
      change30dPoints: m.change30d?.points ?? null, change30dPercent: m.change30d?.percent ?? null,
      changeBaselinePoints: m.changeSinceBaseline?.points ?? null, changeBaselinePercent: m.changeSinceBaseline?.percent ?? null,
      high: m.high?.value ?? null, low: m.low?.value ?? null,
      distFromHighPercent: m.distanceFromHigh?.percent ?? null, distFromLowPercent: m.distanceFromLow?.percent ?? null,
      sparkline: m.sparkline,
      ownerTeam: e.manager.teamName ?? e.manager.displayName,
      signal: signal?.signal ?? null, signalScore: signal?.score ?? null, signalConfidence: signal?.confidence ?? null,
      signalReason: signal?.reasonCodes.map((r) => r.detail).join(" · "),
    };
  });

  const freeAgentRows: PlayerRow[] = freeAgents.map((p) => {
    const m = marketData.get(p.id)!;
    const mix = marketMix.get(p.id)!;
    return {
      id: p.id, fullName: p.fullName, position: p.position, nflTeam: p.nflTeam, status: p.status, slot: "BENCH",
      currentValue: m.currentValue, currentObservedAt: m.currentObservedAt,
      consensusValue: mix.consensusValue, consensusSourceCount: mix.consensusSourceCount, consensusSources: mix.consensusSources,
      fantasyCalcValue: mix.fantasyCalcValue, fantasyCalcRawValue: mix.fantasyCalcRawValue,
      statsGuyValue: mix.statsGuyValue, statsGuyRawValue: mix.statsGuyRawValue,
      isStale: m.isStale, pendingReview: m.pendingReview,
      changeSinceLastRefresh: m.changeSinceLastRefresh?.points ?? null,
      change7dPoints: m.change7d?.points ?? null, change7dPercent: m.change7d?.percent ?? null,
      change30dPoints: m.change30d?.points ?? null, change30dPercent: m.change30d?.percent ?? null,
      changeBaselinePoints: m.changeSinceBaseline?.points ?? null, changeBaselinePercent: m.changeSinceBaseline?.percent ?? null,
      high: m.high?.value ?? null, low: m.low?.value ?? null,
      distFromHighPercent: m.distanceFromHigh?.percent ?? null, distFromLowPercent: m.distanceFromLow?.percent ?? null,
      sparkline: m.sparkline, ownerTeam: null,
    };
  });

  const actionCount = rosteredRows.filter((r) => r.signal && r.signal !== "HOLD").length;
  const staleCount = [...rosteredRows, ...freeAgentRows].filter((r) => r.isStale).length;
  const topFAs = [...freeAgentRows].filter((r) => r.currentValue !== null).sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0)).slice(0, 5);
  const hotFAs = [...freeAgentRows].filter((r) => r.change7dPoints !== null).sort((a, b) => (b.change7dPoints ?? 0) - (a.change7dPoints ?? 0)).slice(0, 5);

  return (
    <div className="space-y-7">
      <section className="hero-panel">
        <div className="relative z-[1]">
          <div className="eyebrow">Search + opportunity radar</div>
          <h1 className="mt-2 text-2xl font-bold text-neutral-50">Player Market</h1>
          <p className="mt-2 max-w-3xl text-sm text-neutral-400">One place to search the entire league, filter by recommendation signal, compare owners, and separate true waiver opportunities from rostered assets.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="metric-card"><div className="metric-label">Rostered</div><div className="metric-value">{rosteredRows.length}</div><div className="metric-sub">league assets</div></div>
            <div className="metric-card"><div className="metric-label">Known free agents</div><div className="metric-value">{freeAgentRows.length}</div><div className="metric-sub">with KTC mapping</div></div>
            <div className="metric-card"><div className="metric-label">Action signals</div><div className="metric-value">{actionCount}</div><div className="metric-sub">non-HOLD rostered players</div></div>
            <div className="metric-card"><div className="metric-label">Stale values</div><div className={`metric-value ${staleCount ? "text-amber-300" : "text-emerald-300"}`}>{staleCount}</div><div className="metric-sub">across player market</div></div>
          </div>
        </div>
      </section>

      {freeAgentRows.length > 0 && (
        <section className="space-y-3">
          <SectionHeader eyebrow="Waiver radar" title="Free agents worth checking first" description="The highest-value available players and the fastest 7-day risers. This is a shortlist, not a replacement for league-specific roster fit." />
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="panel p-4">
              <div className="text-xs font-semibold text-neutral-300">Highest market value</div>
              <div className="mt-2 divide-y divide-neutral-800/80">
                {topFAs.map((r, i) => <Link key={r.id} href={`/players/${r.id}`} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><span className="mr-2 text-[10px] text-neutral-600">#{i+1}</span><span className="text-sm font-medium text-neutral-100">{r.fullName}</span><div className="pl-5 text-[10px] text-neutral-600">{r.position}{r.nflTeam ? ` · ${r.nflTeam}` : ""}</div></div><div className="text-right"><div className="font-semibold text-neutral-100">{formatPoints(r.currentValue)}</div><div className={`text-[10px] ${trendColorClass(r.change7dPoints)}`}>{formatSigned(r.change7dPoints)} 7d</div></div></Link>)}
              </div>
            </div>
            <div className="panel p-4">
              <div className="text-xs font-semibold text-neutral-300">Fastest 7-day risers</div>
              <div className="mt-2 divide-y divide-neutral-800/80">
                {hotFAs.map((r, i) => <Link key={r.id} href={`/players/${r.id}`} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><span className="mr-2 text-[10px] text-neutral-600">#{i+1}</span><span className="text-sm font-medium text-neutral-100">{r.fullName}</span><div className="pl-5 text-[10px] text-neutral-600">{r.position} · KTC {formatPoints(r.currentValue)}</div></div><div className={`text-right font-semibold ${trendColorClass(r.change7dPoints)}`}>{formatSigned(r.change7dPoints)}<div className="text-[10px] font-normal">{r.change7dPercent !== null ? `${r.change7dPercent > 0 ? "+" : ""}${r.change7dPercent.toFixed(1)}%` : ""}</div></div></Link>)}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeader eyebrow="League inventory" title="Rostered players" description="Search by player, NFL team, or owner. Use the signal chips to isolate sell-high, buy-low, watch, or cut-risk profiles." />
        <PlayerTable rows={rosteredRows} showOwner />
      </section>

      {freeAgentRows.length > 0 && (
        <section className="space-y-3">
          <SectionHeader eyebrow="Unrostered inventory" title={`Free Agent Market (${freeAgentRows.length})`} description="Players not rostered in Dynasty Boys with a known KTC mapping. Recommendation signals are intentionally omitted because roster-fit context is owner-specific." />
          <PlayerTable rows={freeAgentRows} />
        </section>
      )}
    </div>
  );
}
