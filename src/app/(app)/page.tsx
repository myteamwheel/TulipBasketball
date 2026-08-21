import Link from "next/link";
import { getPrimaryManager, getCurrentRoster } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations, getLatestSlotMap } from "@/lib/teamMetrics";
import {
  getLatestRefreshRun,
  getLatestSuccessfulSleeperSyncTime,
} from "@/lib/refresh";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import { getVerifiedCheckpointChange } from "@/lib/verifiedCheckpoint";
import PlayerTable, { type PlayerRow } from "@/components/PlayerTable";
import DataBadge from "@/components/DataBadge";
import MetricCard from "@/components/MetricCard";
import SectionHeader from "@/components/SectionHeader";
import SignalBadge from "@/components/SignalBadge";
import {
  formatDateEastern,
  formatPoints,
  formatSigned,
  timeAgo,
} from "@/lib/format";
import { ORLANDO_BASELINE_DATE } from "@/lib/config";
import { getLatestMarketSourceStatuses } from "@/lib/marketSources";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";
export const dynamic = "force-dynamic";
const COVERAGE_MIN = 0.75;
function tone(
  value: number | null | undefined,
): "neutral" | "positive" | "negative" {
  return value == null || value === 0
    ? "neutral"
    : value > 0
      ? "positive"
      : "negative";
}
function coveredValue(
  value: number | null | undefined,
  coverage: number | undefined,
  total: number,
) {
  return value != null && total > 0 && (coverage ?? 0) / total >= COVERAGE_MIN
    ? value
    : null;
}
function providerDetail(
  source: string,
  stale: boolean,
  run: Awaited<ReturnType<typeof getLatestRefreshRun>>,
) {
  if (!stale) return "Fresh provider";
  const latest = run?.marketSourceStatuses.find((row) => row.source === source);
  if (latest?.ok === false) {
    return latest.message.includes("TRADYR_API_KEY")
      ? "API key required"
      : "Refresh failed";
  }
  return "Unavailable";
}
export default async function HomePage() {
  const manager = await getPrimaryManager();
  if (!manager)
    return (
      <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-5 text-sm text-amber-200">
        Orlando Oswalds has not been resolved yet. The next scheduled Sleeper
        sync will retry.
      </div>
    );
  const [
    roster,
    valuations,
    slotMap,
    latestRun,
    lastGoodSleeperSync,
    verifiedCheckpoint,
  ] = await Promise.all([
    getCurrentRoster(manager.id),
    computeAllTeamValuations(),
    getLatestSlotMap(),
    getLatestRefreshRun(),
    getLatestSuccessfulSleeperSyncTime(),
    getVerifiedCheckpointChange(manager.id),
  ]);
  const playerIds = roster.map((p) => p.id);
  const [marketData, marketMix, sourceStatuses, signals] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    getFreshCurrentMarketMix(playerIds),
    getLatestMarketSourceStatuses(),
    computeSignalsForCurrentRoster(),
  ]);
  const rows: PlayerRow[] = roster.map((player) => {
      const market = marketData.get(player.id)!,
        mix = marketMix.get(player.id)!,
        signal = signals.get(player.id)?.result ?? null;
      return {
        id: player.id,
        fullName: player.fullName,
        position: player.position,
        nflTeam: player.nflTeam,
        status: player.status,
        slot: slotMap.get(`${manager.id}:${player.id}`) ?? "BENCH",
        currentValue: market.currentValue,
        currentObservedAt: market.currentObservedAt,
        consensusValue: mix.consensusValue,
        consensusSourceCount: mix.consensusSourceCount,
        consensusSources: mix.consensusSources,
        tradyrValue: mix.tradyrValue,
        dynastyDealerValue: mix.dynastyDealerValue,
        isStale: market.isStale,
        pendingReview: market.pendingReview,
        changeSinceLastRefresh: market.changeSinceLastRefresh?.points ?? null,
        change7dPoints: market.change7d?.points ?? null,
        change7dPercent: market.change7d?.percent ?? null,
        change30dPoints: market.change30d?.points ?? null,
        change30dPercent: market.change30d?.percent ?? null,
        changeBaselinePoints: market.changeSinceBaseline?.points ?? null,
        changeBaselinePercent: market.changeSinceBaseline?.percent ?? null,
        high: market.high?.value ?? null,
        low: market.low?.value ?? null,
        distFromHighPercent: market.distanceFromHigh?.percent ?? null,
        distFromLowPercent: market.distanceFromLow?.percent ?? null,
        sparkline: market.sparkline,
        signal: market.isStale ? null : (signal?.signal ?? null),
        signalScore: market.isStale ? null : (signal?.score ?? null),
        signalConfidence: market.isStale ? null : (signal?.confidence ?? null),
        signalReason: market.isStale
          ? null
          : (signal?.reasonCodes
              .slice(0, 2)
              .map((r) => r.detail)
              .join(" · ") ?? null),
      };
    }),
    my = valuations.find((v) => v.managerId === manager.id);
  if (!my) return null;
  const anyIncomplete = valuations.some((v) => !v.capitalComplete),
    rank = (
      key:
        | "totalDynastyValue"
        | "playerCapital"
        | "draftCapital"
        | "optimalLineupValue"
        | "depthValue",
    ) =>
      [...valuations]
        .sort((a, b) => b[key] - a[key])
        .findIndex((v) => v.managerId === manager.id) + 1,
    totalPlayers = my.playerCount,
    change7d = coveredValue(my.change7d, my.change7dCoverage, totalPlayers),
    change30d = coveredValue(my.change30d, my.change30dCoverage, totalPlayers),
    baselineChange = coveredValue(
      my.changeSinceBaseline,
      my.changeSinceBaselineCoverage,
      totalPlayers,
    ),
    checkpointChange = sourceStatuses.KTC?.stale
      ? null
      : verifiedCheckpoint.change,
    latestSleeperFailed =
      !!latestRun &&
      latestRun.status !== "RUNNING" &&
      latestRun.sleeperSyncOk === false,
    draftUnavailable = !my.draftMarketAvailable,
    draftStale = my.draftMarketStale || my.draftOwnershipStale,
    actionable = rows
      .filter(
        (r) =>
          ["SELL_HIGH", "BUY_LOW", "CUT_BAIT"].includes(r.signal ?? "") &&
          r.signalConfidence !== "LOW",
      )
      .sort((a, b) => (b.signalScore ?? 0) - (a.signalScore ?? 0))
      .slice(0, 4),
    spreads = rows
      .filter(
        (r) =>
          !r.isStale && r.consensusValue !== null && r.currentValue !== null,
      )
      .map((r) => ({
        ...r,
        spreadPct:
          ((r.consensusValue! - r.currentValue!) / r.currentValue!) * 100,
        spreadPoints: r.consensusValue! - r.currentValue!,
      }))
      .filter(
        (r) => Math.abs(r.spreadPct) >= 3 && Math.abs(r.spreadPoints) >= 100,
      )
      .sort((a, b) => Math.abs(b.spreadPct) - Math.abs(a.spreadPct))
      .slice(0, 4),
    baselineLabel = formatDateEastern(ORLANDO_BASELINE_DATE),
    consensusCovered = roster.filter(
      (p) => marketMix.get(p.id)?.consensusValue !== null,
    ).length,
    provisional = anyIncomplete ? "~" : "#";
  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <section>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-100 sm:text-2xl">
              Orlando Oswalds
            </h1>
            <p className="mt-1 text-[11px] text-neutral-500 sm:text-xs">
              {roster.length} current roster entries · last confirmed Sleeper
              sync {timeAgo(lastGoodSleeperSync)}
            </p>
          </div>
          <Link
            href="/trade-finder"
            className="mt-2 inline-flex w-fit rounded-md border border-emerald-800 bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-300 sm:mt-0"
          >
            Open Trade Lab →
          </Link>
        </div>
      </section>
      {latestSleeperFailed ? (
        <div className="rounded-lg border border-red-900/80 bg-red-950/25 p-3 text-xs leading-5 text-red-200">
          The latest Sleeper sync failed. Showing the last confirmed roster from{" "}
          {timeAgo(lastGoodSleeperSync)}.
        </div>
      ) : null}
      {anyIncomplete ? (
        <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-[11px] leading-5 text-amber-200">
          League capital ranks are <strong>provisional</strong>:{" "}
          {valuations.reduce((s, v) => s + v.missingValueCount, 0)} rostered
          player values are unknown on other rosters. Orlando is{" "}
          {my.lastKnownPlayerCount}/{my.playerCount} covered; unknown opposing
          assets are not treated as zero.
        </div>
      ) : null}
      {draftStale && !draftUnavailable ? (
        <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-[11px] text-amber-200">
          Draft portfolio is last-known because the pick board or pick ownership
          is stale. Current Trade Lab pick recommendations are withheld until
          both are fresh.
        </div>
      ) : null}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-neutral-200">
              Current data health
            </div>
            <div className="text-[10px] text-neutral-600">
              Fresh provider status and Orlando coverage are separate checks.
            </div>
          </div>
          <Link href="/settings" className="text-[10px] text-neutral-500">
            Details
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DataBadge
            label="Sleeper"
            state={
              latestSleeperFailed
                ? "bad"
                : lastGoodSleeperSync
                  ? "good"
                  : "warn"
            }
            detail={
              latestSleeperFailed
                ? "Last sync failed"
                : lastGoodSleeperSync
                  ? "Available"
                  : "Unavailable"
            }
          />
          <DataBadge
            label="KTC"
            state={sourceStatuses.KTC.stale ? "warn" : "good"}
            detail={`${my.lastKnownPlayerCount}/${my.playerCount} Orlando`}
          />
          <DataBadge
            label="Tradyr"
            state={sourceStatuses.TRADYR.stale ? "warn" : "good"}
            detail={providerDetail(
              "TRADYR",
              sourceStatuses.TRADYR.stale,
              latestRun,
            )}
          />
          <DataBadge
            label="Dynasty Dealer"
            state={sourceStatuses.DYNASTY_DEALER.stale ? "warn" : "good"}
            detail={providerDetail(
              "DYNASTY_DEALER",
              sourceStatuses.DYNASTY_DEALER.stale,
              latestRun,
            )}
          />
        </div>
      </section>
      <section>
        <SectionHeader
          title="Dynasty snapshot"
          description="Known capital never converts missing values to zero. IR/taxi players are excluded from current start-eligible lineup strength. Verified checkpoints are labeled by their real date rather than forced into a 7-day/30-day bucket."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <MetricCard
            label={
              draftUnavailable
                ? "Known player capital"
                : "Known dynasty capital"
            }
            value={formatPoints(
              draftUnavailable ? my.playerCapital : my.totalDynastyValue,
            )}
            tone={anyIncomplete || draftStale ? "warning" : "neutral"}
            detail={`${provisional}${rank(draftUnavailable ? "playerCapital" : "totalDynastyValue")}/${valuations.length}${anyIncomplete ? " provisional" : ""}`}
          />
          <MetricCard
            label="Player capital"
            value={formatPoints(my.playerCapital)}
            detail={`${provisional}${rank("playerCapital")} · ${my.lastKnownPlayerCount}/${my.playerCount} known`}
          />
          <MetricCard
            label="Draft capital"
            value={draftUnavailable ? "—" : formatPoints(my.draftCapital)}
            tone={draftStale ? "warning" : "neutral"}
            detail={
              draftUnavailable
                ? "unavailable"
                : `#${rank("draftCapital")} · ${my.draftPickCount} picks`
            }
          />
          <MetricCard
            label="Start-eligible lineup"
            value={formatPoints(my.optimalLineupValue)}
            detail={`${provisional}${rank("optimalLineupValue")} · IR/taxi excluded`}
          />
          <MetricCard
            label="7-day"
            value={change7d === null ? "—" : formatSigned(change7d)}
            tone={tone(change7d)}
            detail={`${my.change7dCoverage}/${totalPlayers} comparable`}
          />
          <MetricCard
            label="30-day"
            value={change30d === null ? "—" : formatSigned(change30d)}
            tone={tone(change30d)}
            detail={`${my.change30dCoverage}/${totalPlayers} comparable`}
          />
          <MetricCard
            label="Since Aug. 13 verified"
            value={
              checkpointChange === null ? "—" : formatSigned(checkpointChange)
            }
            tone={tone(checkpointChange)}
            detail={`${verifiedCheckpoint.comparablePlayers}/${verifiedCheckpoint.rosterPlayers} comparable`}
          />
          <MetricCard
            label={`Since ${baselineLabel}`}
            value={baselineChange === null ? "—" : formatSigned(baselineChange)}
            tone={tone(baselineChange)}
            detail={`${my.changeSinceBaselineCoverage}/${totalPlayers} comparable`}
          />
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <SectionHeader
            title="Decision Center"
            href="/players"
            hrefLabel="All players"
          />
          <div className="space-y-2">
            {actionable.length ? (
              actionable.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3"
                >
                  <Link href={`/players/${row.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-neutral-100">
                      {row.fullName}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[10px] text-neutral-500">
                      {row.signalReason}
                    </div>
                  </Link>
                  {row.signal ? (
                    <SignalBadge
                      signal={row.signal}
                      confidence={row.signalConfidence}
                    />
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-xs text-neutral-500">
                No decision-grade directional action right now.
              </div>
            )}
          </div>
        </section>
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <SectionHeader
            title="Cross-market spread"
            description="Fresh KTC vs fresh trusted secondary blend; this is disagreement, not proof that either side is correct."
          />
          <div className="space-y-2">
            {spreads.length ? (
              spreads.map((row) => (
                <Link
                  key={row.id}
                  href={`/players/${row.id}`}
                  className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3"
                >
                  <div>
                    <div className="truncate text-sm font-medium text-neutral-100">
                      {row.fullName}
                    </div>
                    <div className="text-[10px] text-neutral-600">
                      KTC {formatPoints(row.currentValue)} · trusted{" "}
                      {formatPoints(row.consensusValue)} ·{" "}
                      {formatSigned(row.spreadPoints)}
                    </div>
                  </div>
                  <div
                    className={
                      row.spreadPct >= 0 ? "text-emerald-300" : "text-red-300"
                    }
                  >
                    {row.spreadPct >= 0 ? "+" : ""}
                    {row.spreadPct.toFixed(1)}%
                  </div>
                </Link>
              ))
            ) : (
              <div className="text-xs text-neutral-600">
                No material fresh disagreement.
              </div>
            )}
          </div>
        </section>
      </div>
      {consensusCovered < roster.length ? (
        <div className="text-[10px] text-neutral-700">
          Trusted-market coverage: {consensusCovered}/{roster.length} Orlando
          players.
        </div>
      ) : null}
      <section>
        <SectionHeader
          title="Orlando roster"
          description="Current Sleeper ownership with fresh decision metrics only."
        />
        <PlayerTable rows={rows} />
      </section>
    </div>
  );
}
