import Link from "next/link";
import { getPrimaryManager, getCurrentRoster } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations, getLatestSlotMap } from "@/lib/teamMetrics";
import { getLatestKtcObservationTime, getLatestRefreshRun } from "@/lib/refresh";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import PlayerTable, { type PlayerRow } from "@/components/PlayerTable";
import SectionHeader from "@/components/SectionHeader";
import { formatPoints, formatSigned, trendColorClass, timeAgo } from "@/lib/format";
import { getCurrentMarketMix, getLatestMarketSourceStatuses } from "@/lib/marketSources";
import {
  actionPriority,
  powerTier,
  signalActionCopy,
  sourceGapPct,
  teamGapContext,
  teamPositionRanks,
} from "@/lib/dashboardInsights";

export const dynamic = "force-dynamic";

function MiniMetric({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: number | null }) {
  return (
    <div className="metric-card">
      <p className="metric-label">{label}</p>
      <p className={`metric-value ${trend !== undefined ? trendColorClass(trend) : ""}`}>{value}</p>
      {sub && <p className="metric-sub">{sub}</p>}
    </div>
  );
}

const SIGNAL_TONE: Record<string, string> = {
  SELL_HIGH: "border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-300",
  BUY_LOW: "border-sky-500/25 bg-sky-500/[0.05] text-sky-300",
  CUT_LOSSES: "border-orange-500/25 bg-orange-500/[0.05] text-orange-300",
  CUT_BAIT: "border-red-500/25 bg-red-500/[0.05] text-red-300",
  WATCH: "border-amber-500/25 bg-amber-500/[0.05] text-amber-300",
};

export default async function HomePage() {
  const manager = await getPrimaryManager();
  if (!manager) {
    return <div className="panel p-6 text-sm text-amber-200">Orlando Oswalds hasn&apos;t been resolved yet. Run Refresh Data to sync Sleeper.</div>;
  }

  const [roster, valuations, slotMap, latestRun, latestKtcObservedAt] = await Promise.all([
    getCurrentRoster(manager.id),
    computeAllTeamValuations(),
    getLatestSlotMap(),
    getLatestRefreshRun(),
    getLatestKtcObservationTime(),
  ]);
  const playerIds = roster.map((p) => p.id);
  const [marketData, marketMix, sourceStatuses, signals] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    getCurrentMarketMix(playerIds),
    getLatestMarketSourceStatuses(),
    computeSignalsForCurrentRoster(),
  ]);

  const rows: PlayerRow[] = roster.map((p) => {
    const m = marketData.get(p.id)!;
    const mix = marketMix.get(p.id)!;
    const signal = signals.get(p.id)?.result;
    return {
      id: p.id, fullName: p.fullName, position: p.position, nflTeam: p.nflTeam, status: p.status,
      slot: slotMap.get(`${manager.id}:${p.id}`) ?? "BENCH",
      currentValue: m.currentValue, currentObservedAt: m.currentObservedAt,
      consensusValue: mix.consensusValue, consensusSourceCount: mix.consensusSourceCount, consensusSources: mix.consensusSources,
      statsGuyValue: mix.statsGuyValue, statsGuyRawValue: mix.statsGuyRawValue,
      isStale: m.isStale, pendingReview: m.pendingReview,
      changeSinceLastRefresh: m.changeSinceLastRefresh?.points ?? null,
      change7dPoints: m.change7d?.points ?? null, change7dPercent: m.change7d?.percent ?? null,
      change30dPoints: m.change30d?.points ?? null, change30dPercent: m.change30d?.percent ?? null,
      changeBaselinePoints: m.changeSinceBaseline?.points ?? null, changeBaselinePercent: m.changeSinceBaseline?.percent ?? null,
      high: m.high?.value ?? null, low: m.low?.value ?? null,
      distFromHighPercent: m.distanceFromHigh?.percent ?? null, distFromLowPercent: m.distanceFromLow?.percent ?? null,
      sparkline: m.sparkline,
      signal: signal?.signal ?? null, signalScore: signal?.score ?? null, signalConfidence: signal?.confidence ?? null,
      signalReason: signal?.reasonCodes.map((r) => r.detail).join(" · "),
    };
  });

  const mine = valuations.find((v) => v.managerId === manager.id);
  const rankedTotal = [...valuations].sort((a, b) => b.totalValue - a.totalValue);
  const totalRank = rankedTotal.findIndex((v) => v.managerId === manager.id) + 1;
  const starterRank = [...valuations].sort((a, b) => b.starterValue - a.starterValue).findIndex((v) => v.managerId === manager.id) + 1;
  const benchRank = [...valuations].sort((a, b) => b.benchValue - a.benchValue).findIndex((v) => v.managerId === manager.id) + 1;
  const gap = teamGapContext(valuations, manager.id);
  const tier = powerTier(totalRank, valuations.length);
  const positionRanks = teamPositionRanks(valuations, manager.id);
  const strongestPosition = [...positionRanks].sort((a, b) => a.rank - b.rank)[0];
  const weakestPosition = [...positionRanks].sort((a, b) => b.rank - a.rank)[0];

  const consensusCovered = rows.filter((r) => r.consensusValue !== null).length;
  const consensusValue = rows.reduce((sum, r) => sum + (r.consensusValue ?? 0), 0);
  const top3Value = [...rows].sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0)).slice(0, 3).reduce((s, r) => s + (r.currentValue ?? 0), 0);
  const concentration = mine?.totalValue ? top3Value / mine.totalValue : 0;
  const starterShare = mine?.totalValue ? mine.starterValue / mine.totalValue : 0;

  const actionable = rows
    .filter((r) => r.signal && r.signal !== "HOLD")
    .sort((a, b) => {
      const p = actionPriority(b.signal) - actionPriority(a.signal);
      if (p) return p;
      return Math.abs(b.change7dPercent ?? 0) - Math.abs(a.change7dPercent ?? 0);
    })
    .slice(0, 5);

  const movers = rows.filter((r) => r.change7dPoints !== null);
  const best7d = [...movers].sort((a, b) => (b.change7dPoints ?? 0) - (a.change7dPoints ?? 0))[0];
  const worst7d = [...movers].sort((a, b) => (a.change7dPoints ?? 0) - (b.change7dPoints ?? 0))[0];

  const disagreements = rows
    .map((r) => ({ row: r, gap: sourceGapPct(r.currentValue, r.statsGuyValue) }))
    .filter((x): x is { row: PlayerRow; gap: number } => x.gap !== null)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 5);

  const unmapped = rows.filter((r) => r.currentValue === null).length;
  const stale = rows.filter((r) => r.isStale).length;

  return (
    <div className="space-y-7">
      <section className="hero-panel">
        <div className="relative z-[1] grid gap-5 lg:grid-cols-[1.15fr_.85fr] lg:items-end">
          <div>
            <div className="eyebrow">Orlando Oswalds · decision dashboard</div>
            <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
              <h1 className="text-2xl font-bold tracking-tight text-neutral-50 sm:text-3xl">#{totalRank} in league value</h1>
              <span className="mb-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">{tier.label}</span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-400">
              {gap?.leaderGap === 0 ? "You currently lead the league in total KTC value." : `${formatPoints(gap?.leaderGap ?? 0)} points behind ${gap?.leaderName ?? "the league leader"}.`}
              {gap?.aboveName ? ` ${formatPoints(gap.aboveGap)} separates you from #${Math.max(1, totalRank - 1)}.` : ""}
              {gap?.belowName ? ` Your cushion over the team behind you is ${formatPoints(gap.belowGap)}.` : ""}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-neutral-500">
              <span className="status-pill">Sleeper {timeAgo(latestRun?.finishedAt ?? null)}</span>
              <span className={`status-pill ${sourceStatuses.KTC.stale ? "text-amber-300" : "text-emerald-300"}`}>KTC {sourceStatuses.KTC.stale ? "stale" : "fresh"}</span>
              <span className={`status-pill ${sourceStatuses.STATSGUY.stale ? "text-amber-300" : "text-emerald-300"}`}>Stats Guy {sourceStatuses.STATSGUY.stale ? "stale" : "fresh"}</span>
              <span className="status-pill">KTC observed {timeAgo(latestKtcObservedAt)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
            <MiniMetric label="KTC portfolio" value={formatPoints(mine?.totalValue)} sub={`#${totalRank} of ${valuations.length}`} />
            <MiniMetric label="7-day value move" value={formatSigned(mine?.change7d)} trend={mine?.change7d} sub="whole roster" />
            <MiniMetric label="Starter rank" value={`#${starterRank}`} sub={`${Math.round(starterShare * 100)}% of value in starters`} />
            <MiniMetric label="Depth rank" value={`#${benchRank}`} sub={`${Math.round(concentration * 100)}% in top 3 assets`} />
          </div>
        </div>
      </section>

      {(unmapped > 0 || stale > 0) && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-4 py-2.5 text-xs text-amber-200">
          Data attention: {unmapped > 0 ? `${unmapped} player${unmapped === 1 ? "" : "s"} missing KTC mapping` : ""}{unmapped > 0 && stale > 0 ? " · " : ""}{stale > 0 ? `${stale} stale player value${stale === 1 ? "" : "s"}` : ""}. <Link href="/refresh-history" className="underline decoration-amber-500/50 underline-offset-2">Open Data Health</Link>.
        </div>
      )}

      <section className="space-y-3">
        <SectionHeader eyebrow="What deserves attention" title="Decision Board" description="Prioritized from live recommendation signals and meaningful 7-day movement—not tiny changes between frequent refreshes." />
        <div className="grid gap-3 lg:grid-cols-[1.2fr_.8fr]">
          <div className="grid gap-2 sm:grid-cols-2">
            {actionable.map((r) => (
              <Link key={r.id} href={`/players/${r.id}`} className={`interactive-card rounded-xl border p-3 ${SIGNAL_TONE[r.signal ?? ""] ?? "border-neutral-800 bg-neutral-900"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[.16em] opacity-80">{r.signal?.replaceAll("_", " ")}</div>
                    <div className="mt-1 truncate font-semibold text-neutral-100">{r.fullName}</div>
                    <div className="mt-0.5 text-[11px] text-neutral-500">{r.position} · {r.slot} · KTC {formatPoints(r.currentValue)}</div>
                  </div>
                  <div className={`shrink-0 text-right text-sm font-semibold ${trendColorClass(r.change7dPoints)}`}>{formatSigned(r.change7dPoints)}<div className="text-[9px] font-normal text-neutral-600">7d</div></div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-neutral-400">{signalActionCopy(r.signal)}</p>
              </Link>
            ))}
            {actionable.length === 0 && <div className="panel p-4 text-sm text-neutral-500 sm:col-span-2">No non-HOLD signals right now. The model is not forcing action.</div>}
          </div>

          <div className="panel p-4">
            <div className="eyebrow">Market movement</div>
            <h3 className="mt-1 text-sm font-semibold text-neutral-100">7-day pulse</h3>
            <div className="mt-3 space-y-3">
              {best7d && <Link href={`/players/${best7d.id}`} className="flex items-center justify-between rounded-lg bg-neutral-950/60 p-3"><div><div className="text-[10px] uppercase tracking-wide text-neutral-600">Biggest riser</div><div className="mt-0.5 text-sm font-medium text-neutral-100">{best7d.fullName}</div></div><div className="text-right text-emerald-400"><div className="font-semibold">{formatSigned(best7d.change7dPoints)}</div><div className="text-[10px]">{best7d.change7dPercent !== null ? `${best7d.change7dPercent > 0 ? "+" : ""}${best7d.change7dPercent.toFixed(1)}%` : ""}</div></div></Link>}
              {worst7d && <Link href={`/players/${worst7d.id}`} className="flex items-center justify-between rounded-lg bg-neutral-950/60 p-3"><div><div className="text-[10px] uppercase tracking-wide text-neutral-600">Biggest faller</div><div className="mt-0.5 text-sm font-medium text-neutral-100">{worst7d.fullName}</div></div><div className="text-right text-red-400"><div className="font-semibold">{formatSigned(worst7d.change7dPoints)}</div><div className="text-[10px]">{worst7d.change7dPercent !== null ? `${worst7d.change7dPercent > 0 ? "+" : ""}${worst7d.change7dPercent.toFixed(1)}%` : ""}</div></div></Link>}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader eyebrow="Roster construction" title="Where your value actually lives" description={`Strongest positional market: ${strongestPosition?.position ?? "n/a"} (#${strongestPosition?.rank ?? "—"}). Weakest: ${weakestPosition?.position ?? "n/a"} (#${weakestPosition?.rank ?? "—"}).`} />
        <div className="grid gap-3 lg:grid-cols-[1.15fr_.85fr]">
          <div className="panel p-4">
            <div className="space-y-4">
              {positionRanks.map((p) => {
                const width = p.leaderValue > 0 ? Math.max(5, Math.min(100, (p.value / p.leaderValue) * 100)) : 0;
                return <div key={p.position}>
                  <div className="mb-1.5 flex items-center justify-between text-xs"><div className="flex items-center gap-2"><span className="w-6 font-semibold text-neutral-200">{p.position}</span><span className="text-neutral-500">#{p.rank} / {p.leagueSize}</span></div><div className="text-right"><span className="font-medium text-neutral-200">{formatPoints(p.value)}</span><span className="ml-2 text-[10px] text-neutral-600">{Math.round(p.shareOfRoster * 100)}% roster value</span></div></div>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-800"><div className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-300" style={{ width: `${width}%` }} /></div>
                </div>;
              })}
            </div>
          </div>
          <div className="panel p-4">
            <div className="eyebrow">Source disagreement</div>
            <h3 className="mt-1 text-sm font-semibold text-neutral-100">Where KTC and Stats Guy disagree most</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">Useful as a disagreement flag—not a command to trade. Stats Guy is translated onto the KTC scale first.</p>
            <div className="mt-3 divide-y divide-neutral-800/80">
              {disagreements.map(({ row, gap: marketGap }) => <Link key={row.id} href={`/players/${row.id}`} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><div className="truncate text-xs font-medium text-neutral-200">{row.fullName}</div><div className="text-[10px] text-neutral-600">KTC {formatPoints(row.currentValue)} · SG→KTC {formatPoints(row.statsGuyValue)}</div></div><div className={`shrink-0 text-xs font-semibold ${marketGap >= 0 ? "text-sky-300" : "text-amber-300"}`}>{marketGap > 0 ? "+" : ""}{marketGap.toFixed(1)}%</div></Link>)}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader eyebrow="Reference" title="Full Orlando roster market" description={`KTC is the anchor. Consensus covers ${consensusCovered}/${rows.length} players and currently totals ${formatPoints(consensusValue)}.`} />
        <PlayerTable rows={rows} />
      </section>
    </div>
  );
}
