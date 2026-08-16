import Link from "next/link";
import { getPrimaryManager, getCurrentRoster } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations, getLatestSlotMap } from "@/lib/teamMetrics";
import {
  getLatestKtcObservationTime,
  getLatestRefreshRun,
  getLatestSuccessfulSleeperSyncTime,
} from "@/lib/refresh";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import PlayerTable, { type PlayerRow } from "@/components/PlayerTable";
import DataBadge from "@/components/DataBadge";
import MetricCard from "@/components/MetricCard";
import SectionHeader from "@/components/SectionHeader";
import SignalBadge from "@/components/SignalBadge";
import { formatDateEastern, formatPoints, formatSigned, trendColorClass, timeAgo } from "@/lib/format";
import { ORLANDO_BASELINE_DATE } from "@/lib/config";
import { getLatestMarketSourceStatuses } from "@/lib/marketSources";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";

export const dynamic = "force-dynamic";

function tone(value: number | null | undefined): "neutral" | "positive" | "negative" {
  if (value === null || value === undefined || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function sourceDetail(stale: boolean, observedAt: string | null) {
  if (stale) return observedAt ? `stale · last pull ${timeAgo(observedAt)}` : "no valid live value";
  return observedAt ? `fresh · ${timeAgo(observedAt)}` : "fresh";
}

export default async function HomePage() {
  const manager = await getPrimaryManager();

  if (!manager) {
    return (
      <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-5 text-sm text-amber-200">
        Orlando Oswalds has not been resolved yet. Use <strong>Refresh</strong> above to sync the league from Sleeper.
      </div>
    );
  }

  const [roster, valuations, slotMap, latestRun, latestKtcObservedAt, lastGoodSleeperSync] = await Promise.all([
    getCurrentRoster(manager.id),
    computeAllTeamValuations(),
    getLatestSlotMap(),
    getLatestRefreshRun(),
    getLatestKtcObservationTime(),
    getLatestSuccessfulSleeperSyncTime(),
  ]);

  const playerIds = roster.map((p) => p.id);
  const [marketData, marketMix, sourceStatuses, signals] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    getFreshCurrentMarketMix(playerIds),
    getLatestMarketSourceStatuses(),
    computeSignalsForCurrentRoster(),
  ]);

  const rows: PlayerRow[] = roster.map((p) => {
    const m = marketData.get(p.id)!;
    const mix = marketMix.get(p.id)!;
    const signal = signals.get(p.id)?.result ?? null;
    const conciseReasons = signal?.reasonCodes
      .filter((r) => !r.code.startsWith("SLOT_"))
      .slice(0, 2)
      .map((r) => r.detail)
      .join(" · ") ?? null;

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
      signal: signal?.signal ?? null,
      signalScore: signal?.score ?? null,
      signalConfidence: signal?.confidence ?? null,
      signalReason: conciseReasons,
    };
  });

  const myValuation = valuations.find((v) => v.managerId === manager.id);
  const rankedByTotal = [...valuations].sort((a, b) => b.totalValue - a.totalValue);
  const totalRank = rankedByTotal.findIndex((v) => v.managerId === manager.id) + 1;
  const rankedByStarter = [...valuations].sort((a, b) => b.starterValue - a.starterValue);
  const starterRank = rankedByStarter.findIndex((v) => v.managerId === manager.id) + 1;
  const rankedByBench = [...valuations].sort((a, b) => b.benchValue - a.benchValue);
  const benchRank = rankedByBench.findIndex((v) => v.managerId === manager.id) + 1;

  const consensusCoveredPlayers = roster.filter((p) => marketMix.get(p.id)?.consensusValue !== null).length;
  const consensusPortfolioValue = roster.reduce((sum, p) => sum + (marketMix.get(p.id)?.consensusValue ?? 0), 0);
  const unmappedCount = rows.filter((r) => r.currentValue === null).length;
  const trustedSourcesFresh = [sourceStatuses.KTC, sourceStatuses.TRADYR, sourceStatuses.DYNASTY_DEALER].filter((s) => !s.stale).length;
  const latestSleeperFailed = !!latestRun && latestRun.status !== "RUNNING" && latestRun.sleeperSyncOk === false;

  const actionable = rows
    .filter((r) => ["SELL_HIGH", "BUY_LOW", "CUT_BAIT"].includes(r.signal ?? "") && r.signalConfidence !== "LOW")
    .sort((a, b) => (b.signalScore ?? 0) - (a.signalScore ?? 0))
    .slice(0, 4);

  const marketDislocations = rows
    .filter((r) => r.consensusValue !== null && r.currentValue !== null)
    .map((r) => ({ ...r, spread: (r.consensusValue ?? 0) - (r.currentValue ?? 0) }))
    .filter((r) => Math.abs(r.spread) >= 100)
    .sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread))
    .slice(0, 4);

  const positionPower = ["QB", "RB", "WR", "TE"].map((position) => {
    const ranked = [...valuations].sort((a, b) => (b.positionalValue[position] ?? 0) - (a.positionalValue[position] ?? 0));
    return {
      position,
      value: myValuation?.positionalValue[position] ?? 0,
      rank: ranked.findIndex((v) => v.managerId === manager.id) + 1,
    };
  });

  const baselineLabel = formatDateEastern(ORLANDO_BASELINE_DATE);
  const totalPlayers = myValuation?.playerCount ?? roster.length;

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <section className="min-w-0">
        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-neutral-100 sm:text-2xl">Orlando Oswalds</h1>
            <p className="mt-1 text-[11px] leading-4 text-neutral-500 sm:text-xs">
              {roster.length} current Sleeper roster entries · last confirmed roster sync {timeAgo(lastGoodSleeperSync)} · KTC {timeAgo(latestKtcObservedAt)}
            </p>
          </div>
          <Link href="/trade-finder" className="mt-2 inline-flex w-fit items-center rounded-md border border-emerald-800 bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-950/60 sm:mt-0">
            Open Trade Finder →
          </Link>
        </div>
      </section>

      {latestSleeperFailed ? (
        <div className="rounded-lg border border-red-900/80 bg-red-950/25 p-3 text-xs leading-5 text-red-200">
          <strong>Roster warning:</strong> the latest refresh did not successfully update Sleeper. The dashboard is showing the last confirmed roster snapshot from {timeAgo(lastGoodSleeperSync)}. Market prices may be newer than the roster. Open the refresh status above for the failed source detail.
        </div>
      ) : null}

      {unmappedCount > 0 ? (
        <div className="rounded-lg border border-amber-900/80 bg-amber-950/25 p-3 text-xs leading-5 text-amber-200">
          <strong>{unmappedCount} current roster player{unmappedCount === 1 ? "" : "s"}</strong> have no valid KTC mapping and are excluded from KTC totals. <Link href="/settings" className="underline">Review mappings</Link>.
        </div>
      ) : null}

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-neutral-200">Data status</div>
            <div className="text-[10px] text-neutral-600">Roster truth comes from Sleeper. KTC is the market anchor.</div>
          </div>
          <Link href="/settings" className="shrink-0 text-[10px] font-medium text-neutral-500 hover:text-neutral-300">Details</Link>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DataBadge label="Sleeper" state={latestSleeperFailed ? "bad" : lastGoodSleeperSync ? "good" : "warn"} detail={lastGoodSleeperSync ? `synced ${timeAgo(lastGoodSleeperSync)}` : "not synced"} />
          <DataBadge label="KTC" state={sourceStatuses.KTC.stale ? "warn" : "good"} detail={sourceDetail(sourceStatuses.KTC.stale, sourceStatuses.KTC.observedAt)} />
          <DataBadge label="Tradyr" state={sourceStatuses.TRADYR.stale ? "warn" : "good"} detail={sourceDetail(sourceStatuses.TRADYR.stale, sourceStatuses.TRADYR.observedAt)} />
          <DataBadge label="Dynasty Dealer" state={sourceStatuses.DYNASTY_DEALER.stale ? "warn" : "good"} detail={sourceDetail(sourceStatuses.DYNASTY_DEALER.stale, sourceStatuses.DYNASTY_DEALER.observedAt)} />
        </div>
        <div className="mt-2 text-[10px] text-neutral-600">{trustedSourcesFresh}/3 trusted market feeds are fresh. FantasyCalc and Stats Guy remain diagnostics only and are intentionally not shown here.</div>
      </section>

      <section>
        <SectionHeader title="Team snapshot" description="Primary numbers only. Historical windows show a value only when the stored checkpoint actually matches that window." />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="KTC roster value" value={formatPoints(myValuation?.totalValue)} detail={`${myValuation?.valuedPlayerCount ?? 0}/${totalPlayers} valued`} />
          <MetricCard label="League rank" value={`#${totalRank} / ${valuations.length}`} detail="Current player KTC total" />
          <MetricCard label="Starter rank" value={`#${starterRank}`} detail={`Depth rank #${benchRank}`} />
          <MetricCard label="Trusted consensus" value={consensusCoveredPlayers ? formatPoints(consensusPortfolioValue) : "—"} detail={`${consensusCoveredPlayers}/${roster.length} covered`} />
          <MetricCard
            label="7-day change"
            value={myValuation?.change7d === null || myValuation?.change7d === undefined ? "—" : formatSigned(myValuation.change7d)}
            tone={tone(myValuation?.change7d)}
            detail={myValuation?.change7dCoverage ? `${myValuation.change7dCoverage}/${totalPlayers} exact-window comps · 30d ${formatSigned(myValuation.change30d)}` : "No valid 7-day checkpoint yet — no substitution"}
          />
          <MetricCard
            label={`Since ${baselineLabel}`}
            value={myValuation?.changeSinceBaseline === null || myValuation?.changeSinceBaseline === undefined ? "—" : formatSigned(myValuation.changeSinceBaseline)}
            tone={tone(myValuation?.changeSinceBaseline)}
            detail={`${myValuation?.changeSinceBaselineCoverage ?? 0}/${totalPlayers} comparable players`}
          />
        </div>
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
          <SectionHeader
            title="Decision Center"
            description="Directional calls require a real recent comparison window. Sparse history is WATCH, not a fake high-confidence sell/buy signal."
            href="/players"
            hrefLabel="All players"
          />
          <div className="space-y-2">
            {actionable.length ? actionable.map((r) => (
              <Link key={r.id} href={`/players/${r.id}`} className="flex min-w-0 items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3 transition hover:border-neutral-700 hover:bg-neutral-900">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-100">{r.fullName}</div>
                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-neutral-500">{r.signalReason ?? "No concise reason available."}</div>
                </div>
                {r.signal ? <SignalBadge signal={r.signal} score={r.signalScore} confidence={r.signalConfidence} /> : null}
              </Link>
            )) : (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-xs leading-5 text-neutral-500">
                No high-confidence directional action right now. That is intentional when recent history is incomplete; the dashboard will not turn old checkpoints into fake 7-day/30-day evidence.
              </div>
            )}
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
          <SectionHeader title="Cross-market spread" description="Consensus minus KTC. Positive means the trusted blend is higher than KTC; negative means lower. This is disagreement, not automatically a buy/sell call." />
          <div className="space-y-2">
            {marketDislocations.length ? marketDislocations.map((r) => (
              <Link key={r.id} href={`/players/${r.id}`} className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3 hover:border-neutral-700">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-neutral-100">{r.fullName}</div>
                  <div className="mt-0.5 text-[10px] text-neutral-600">KTC {formatPoints(r.currentValue)} · consensus {formatPoints(r.consensusValue)}</div>
                </div>
                <div className={`shrink-0 text-sm font-semibold tabular-nums ${trendColorClass(r.spread)}`}>{r.spread > 0 ? "+" : ""}{formatPoints(r.spread)}</div>
              </Link>
            )) : <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-xs text-neutral-500">No meaningful trusted-market disagreement at the moment.</div>}
          </div>
        </section>
      </div>

      <section className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
        <SectionHeader title="Position strength" description="Current player KTC value and league rank by position. Draft picks are not included in these positional totals." />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {positionPower.map((p) => (
            <div key={p.position} className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">{p.position}</div>
              <div className="mt-1 truncate text-lg font-semibold tabular-nums text-neutral-100">{formatPoints(p.value)}</div>
              <div className="mt-0.5 text-[10px] text-emerald-400">#{p.rank} of {valuations.length}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="min-w-0">
        <SectionHeader title="Current roster" description="Sorted by KTC by default. On mobile, tap a player for full history and source detail." />
        <PlayerTable rows={rows} />
      </section>
    </div>
  );
}
