import Link from "next/link";
import { getPrimaryManager, getCurrentRoster } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations, getLatestSlotMap } from "@/lib/teamMetrics";
import { getLatestKtcObservationTime, getLatestRefreshRun } from "@/lib/refresh";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import PlayerTable, { type PlayerRow } from "@/components/PlayerTable";
import { formatDateEastern, formatPoints, formatSigned, trendColorClass, timeAgo } from "@/lib/format";
import { ORLANDO_BASELINE_DATE } from "@/lib/config";
import { getCurrentMarketMix, getLatestMarketSourceStatuses } from "@/lib/marketSources";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  sub,
  trendValue,
}: {
  label: string;
  value: string;
  sub?: string;
  trendValue?: number | null;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-100">{value}</p>
      {sub && (
        <p className={`mt-0.5 text-xs ${trendValue !== undefined ? trendColorClass(trendValue) : "text-neutral-500"}`}>
          {sub}
        </p>
      )}
    </div>
  );
}

export default async function HomePage() {
  const manager = await getPrimaryManager();

  if (!manager) {
    return (
      <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-6 text-sm text-amber-200">
        Orlando Oswalds hasn&rsquo;t been resolved yet. Click <strong>Refresh Data</strong> above to sync
        with Sleeper.
      </div>
    );
  }

  const [roster, valuations, slotMap, latestRun, latestKtcObservedAt] = await Promise.all([
    getCurrentRoster(manager.id),
    computeAllTeamValuations(),
    getLatestSlotMap(),
    getLatestRefreshRun(),
    getLatestKtcObservationTime(),
  ]);

  const playerIds = roster.map((p) => p.id);
  const [marketData, marketMix, sourceStatuses] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    getCurrentMarketMix(playerIds),
    getLatestMarketSourceStatuses(),
  ]);
  const signals = await computeSignalsForCurrentRoster();
  const consensusCoveredPlayers = roster.filter((p) => marketMix.get(p.id)?.consensusValue !== null).length;
  const consensusPortfolioValue = roster.reduce((sum, p) => sum + (marketMix.get(p.id)?.consensusValue ?? 0), 0);

  const myValuation = valuations.find((v) => v.managerId === manager.id);
  const rankedByTotal = [...valuations].sort((a, b) => b.totalValue - a.totalValue);
  const totalRank = rankedByTotal.findIndex((v) => v.managerId === manager.id) + 1;
  const rankedByStarter = [...valuations].sort((a, b) => b.starterValue - a.starterValue);
  const starterRank = rankedByStarter.findIndex((v) => v.managerId === manager.id) + 1;
  const rankedByBench = [...valuations].sort((a, b) => b.benchValue - a.benchValue);
  const benchRank = rankedByBench.findIndex((v) => v.managerId === manager.id) + 1;

  const rows: PlayerRow[] = roster.map((p) => {
    const m = marketData.get(p.id)!;
    const mix = marketMix.get(p.id)!;
    return {
      id: p.id,
      fullName: p.fullName,
      position: p.position,
      nflTeam: p.nflTeam,
      status: p.status,
      slot: slotMap.get(`${manager.id}:${p.id}`) ?? "BENCH",
      currentValue: m.currentValue,
      currentObservedAt: m.currentObservedAt,
      consensusValue: mix.consensusValue,
      consensusSourceCount: mix.consensusSourceCount,
      consensusSources: mix.consensusSources,
      tradyrValue: mix.tradyrValue,
      dynastyDealerValue: mix.dynastyDealerValue,
      fantasyCalcValue: mix.fantasyCalcValue,
      statsGuyValue: mix.statsGuyValue,
      isStale: m.isStale,
      pendingReview: m.pendingReview,
      changeSinceLastRefresh: m.changeSinceLastRefresh?.points ?? null,
      change7dPoints: m.change7d?.points ?? null,
      change7dPercent: m.change7d?.percent ?? null,
      change30dPoints: m.change30d?.points ?? null,
      change30dPercent: m.change30d?.percent ?? null,
      changeBaselinePoints: m.changeSinceBaseline?.points ?? null,
      changeBaselinePercent: m.changeSinceBaseline?.percent ?? null,
      high: m.high?.value ?? null,
      low: m.low?.value ?? null,
      distFromHighPercent: m.distanceFromHigh?.percent ?? null,
      distFromLowPercent: m.distanceFromLow?.percent ?? null,
      sparkline: m.sparkline,
      signal: signals.get(p.id)?.result.signal ?? null,
      signalScore: signals.get(p.id)?.result.score ?? null,
      signalConfidence: signals.get(p.id)?.result.confidence ?? null,
      signalReason: signals
        .get(p.id)
        ?.result.reasonCodes.map((r) => r.detail)
        .join(" · "),
    };
  });

  const nearHigh = rows.filter((r) => r.distFromHighPercent !== null && r.distFromHighPercent >= -5).length;
  const nearLow = rows.filter((r) => r.distFromLowPercent !== null && r.distFromLowPercent <= 5).length;
  const withMovement = rows.filter((r) => r.changeSinceLastRefresh !== null);
  const largestRiser = [...withMovement].sort(
    (a, b) => (b.changeSinceLastRefresh ?? 0) - (a.changeSinceLastRefresh ?? 0),
  )[0];
  const largestFaller = [...withMovement].sort(
    (a, b) => (a.changeSinceLastRefresh ?? 0) - (b.changeSinceLastRefresh ?? 0),
  )[0];
  const unmappedCount = rows.filter((r) => r.currentValue === null).length;
  const trustedSourcesFresh = [sourceStatuses.KTC, sourceStatuses.TRADYR, sourceStatuses.DYNASTY_DEALER].filter((s) => !s.stale).length;
  const actionable = rows
    .filter((r) => ["SELL_HIGH", "BUY_LOW", "CUT_BAIT"].includes(r.signal ?? ""))
    .sort((a, b) => (b.signalScore ?? 0) - (a.signalScore ?? 0))
    .slice(0, 4);
  const marketDislocations = rows
    .filter((r) => r.consensusValue !== null && r.currentValue !== null)
    .map((r) => ({ ...r, spread: (r.consensusValue ?? 0) - (r.currentValue ?? 0) }))
    .sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread))
    .slice(0, 4);
  const positionPower = ["QB", "RB", "WR", "TE"].map((position) => {
    const ranked = [...valuations].sort((a, b) => (b.positionalValue[position] ?? 0) - (a.positionalValue[position] ?? 0));
    return { position, value: myValuation?.positionalValue[position] ?? 0, rank: ranked.findIndex((v) => v.managerId === manager.id) + 1 };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Orlando Oswalds</h1>
          <p className="text-sm text-neutral-500">
            {roster.length} rostered players · Sleeper synced {timeAgo(latestRun?.finishedAt ?? null)} · KTC observed {timeAgo(latestKtcObservedAt)}
          </p>
        </div>
      </div>

      {unmappedCount > 0 && (
        <div className="rounded-md border border-amber-800 bg-amber-950/30 px-4 py-2 text-xs text-amber-300">
          {unmappedCount} rostered players have no KTC value yet — excluded from totals below. Import KTC
          data in <Link href="/settings" className="underline">Settings</Link> to resolve.
        </div>
      )}

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4 text-xs text-neutral-400">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-neutral-200">Data Health · Patch 14</span>
          <span className={trustedSourcesFresh >= 2 ? "text-emerald-400" : "text-amber-400"}>{trustedSourcesFresh}/3 trusted feeds fresh</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(["KTC", "TRADYR", "DYNASTY_DEALER", "FANTASYCALC", "STATSGUY"] as const).map((source) => (
            <span key={source}>
              {source === "DYNASTY_DEALER" ? "Dynasty Dealer" : source === "STATSGUY" ? "Stats Guy" : source === "FANTASYCALC" ? "FantasyCalc" : source}
              {source === "FANTASYCALC" || source === "STATSGUY" ? <span className="text-neutral-600"> (diagnostic)</span> : null}:{" "}
              <span className={sourceStatuses[source].stale ? "text-amber-400" : "text-emerald-400"}>{sourceStatuses[source].stale ? "stale/unavailable" : "fresh"}</span>
            </span>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-neutral-600">Consensus requires current KTC plus at least one trusted KTC-scaled secondary. Outlier secondaries are retained for audit but excluded from the blend.</div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="KTC Portfolio Value" value={formatPoints(myValuation?.totalValue)} />
        <StatCard
          label="Market Consensus Value"
          value={consensusCoveredPlayers > 0 ? formatPoints(consensusPortfolioValue) : "n/a"}
          sub={`${consensusCoveredPlayers}/${roster.length} players · ≥2 fresh sources required`}
        />
        <StatCard
          label="Since Last Refresh"
          value={formatSigned(myValuation?.changeSinceLastRefresh)}
          trendValue={myValuation?.changeSinceLastRefresh}
        />
        <StatCard
          label="7-Day Change"
          value={formatSigned(myValuation?.change7d)}
          trendValue={myValuation?.change7d}
        />
        <StatCard
          label="30-Day Change"
          value={formatSigned(myValuation?.change30d)}
          trendValue={myValuation?.change30d}
        />
        <StatCard
          label={`Since Baseline (${formatDateEastern(ORLANDO_BASELINE_DATE)})`}
          value={
            myValuation?.changeSinceBaseline !== null && myValuation?.changeSinceBaseline !== undefined
              ? formatSigned(myValuation.changeSinceBaseline)
              : "n/a"
          }
          trendValue={myValuation?.changeSinceBaseline ?? undefined}
        />
        <StatCard label="League Rank (Total)" value={`#${totalRank} / ${valuations.length}`} />
        <StatCard label="Starter-Value Rank" value={`#${starterRank}`} sub={`Bench/Depth rank: #${benchRank}`} />
        <StatCard
          label="High / Low Watch"
          value={`${nearHigh} near high`}
          sub={`${nearLow} near low`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {largestRiser && (
          <div className="rounded-lg border border-emerald-900 bg-emerald-950/20 p-3 text-sm">
            <span className="text-neutral-400">Largest riser: </span>
            <Link href={`/players/${largestRiser.id}`} className="font-medium text-emerald-400 hover:underline">
              {largestRiser.fullName}
            </Link>{" "}
            <span className={trendColorClass(largestRiser.changeSinceLastRefresh)}>
              {formatSigned(largestRiser.changeSinceLastRefresh)}
            </span>
          </div>
        )}
        {largestFaller && (
          <div className="rounded-lg border border-red-900 bg-red-950/20 p-3 text-sm">
            <span className="text-neutral-400">Largest faller: </span>
            <Link href={`/players/${largestFaller.id}`} className="font-medium text-red-400 hover:underline">
              {largestFaller.fullName}
            </Link>{" "}
            <span className={trendColorClass(largestFaller.changeSinceLastRefresh)}>
              {formatSigned(largestFaller.changeSinceLastRefresh)}
            </span>
          </div>
        )}
      </div>


      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div><h2 className="text-sm font-semibold text-neutral-100">Decision Center</h2><p className="text-[11px] text-neutral-500">Highest-conviction actions from value momentum + roster context.</p></div>
            <Link href="/players" className="text-[11px] text-emerald-400 hover:underline">All players</Link>
          </div>
          <div className="space-y-2">
            {actionable.length ? actionable.map((r) => (
              <Link key={r.id} href={`/players/${r.id}`} className="flex items-center justify-between rounded-md bg-neutral-950 px-3 py-2 hover:bg-neutral-800">
                <div><div className="text-sm text-neutral-100">{r.fullName}</div><div className="max-w-md truncate text-[10px] text-neutral-600">{r.signalReason ?? "Market signal"}</div></div>
                <div className="text-right"><div className="text-xs font-medium text-emerald-300">{r.signal?.replace("_", " ")}</div><div className="text-[10px] text-neutral-600">{r.signalScore ?? 0}/100</div></div>
              </Link>
            )) : <p className="text-xs text-neutral-500">No high-conviction action signal right now.</p>}
          </div>
        </section>
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-100">Opportunity Radar</h2>
          <p className="mb-3 text-[11px] text-neutral-500">Largest trusted-market disagreement versus KTC.</p>
          <div className="space-y-2">
            {marketDislocations.map((r) => (
              <Link key={r.id} href={`/players/${r.id}`} className="flex items-center justify-between rounded-md bg-neutral-950 px-3 py-2 hover:bg-neutral-800">
                <span className="text-sm text-neutral-100">{r.fullName}</span>
                <span className={trendColorClass(r.spread)}>{r.spread >= 0 ? "+" : ""}{formatPoints(r.spread)}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">Orlando Power Board</h2>
        <p className="mb-3 text-[11px] text-neutral-500">KTC value and league rank by position.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {positionPower.map((p) => <div key={p.position} className="rounded-md bg-neutral-950 p-3"><div className="text-[11px] text-neutral-500">{p.position}</div><div className="text-lg font-semibold text-neutral-100">{formatPoints(p.value)}</div><div className="text-[11px] text-emerald-400">#{p.rank} / {valuations.length}</div></div>)}
        </div>
      </section>

      <PlayerTable rows={rows} />
    </div>
  );
}
