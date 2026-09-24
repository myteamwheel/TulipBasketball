import {
  getAllCurrentRosterEntries,
  getPlayersNeedingMappingReview,
} from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";
import {
  KTC_FORMAT_LABEL,
  MARKET_SOURCE_MAX_AGE_HOURS,
  ORLANDO_BASELINE_DATE,
} from "@/lib/config";
import { getLatestMarketSourceStatuses } from "@/lib/marketSources";
import { fetchDraftPickMarketForCapital } from "@/lib/pickMarket";
import { fetchTradedPickOwnershipState } from "@/lib/pickOwnership";
import { getFootballCoverage } from "@/lib/footballCoverage";
import { getLatestRefreshRun } from "@/lib/refresh";
import { getProjectionDashboardData } from "@/lib/weeklyProjection";
import { formatDateEastern, formatDateTimeEastern, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const pct = (value: number) => {
  const bounded = Math.max(0, Math.min(1, value)) * 100;
  if (bounded === 0 || bounded === 100) return `${Math.round(bounded)}%`;
  return `${bounded.toFixed(1)}%`;
};

export default async function SettingsPage() {
  const [
    needsReview,
    statuses,
    entries,
    pickMarket,
    pickOwnership,
    football,
    latestRun,
    projectionData,
  ] = await Promise.all([
    getPlayersNeedingMappingReview(),
    getLatestMarketSourceStatuses(),
    getAllCurrentRosterEntries(),
    fetchDraftPickMarketForCapital().catch(() => null),
    fetchTradedPickOwnershipState().catch(() => null),
    getFootballCoverage().catch(() => null),
    getLatestRefreshRun(),
    getProjectionDashboardData().catch(() => null),
  ]);
  const ids = entries.map((entry) => entry.playerId);
  const [market, mix] = await Promise.all([
    computeMarketDataForPlayers(ids),
    getFreshCurrentMarketMix(ids),
  ]);
  const owned = entries.length;
  const freshKtc = entries.filter((entry) => {
    const row = market.get(entry.playerId);
    return !!row && !row.isStale && row.currentValue !== null;
  }).length;
  const anyKtc = entries.filter(
    (entry) => market.get(entry.playerId)?.currentValue !== null,
  ).length;
  const ktcExceptions = entries
    .map((entry) => {
      const row = market.get(entry.playerId);
      if (row && !row.isStale && row.currentValue !== null) return null;
      const reason =
        entry.player.mappingStatus !== "MAPPED"
          ? "identity mapping needs review"
          : !entry.player.nflTeam
            ? "no current NFL team"
            : row?.isStale
              ? "KTC observation is stale"
              : "no current KTC value";
      return {
        playerId: entry.playerId,
        name: entry.player.fullName,
        position: entry.player.position,
        nflTeam: entry.player.nflTeam,
        reason,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tradyrCovered = entries.filter(
    (entry) => mix.get(entry.playerId)?.tradyrValue !== null,
  ).length;
  const dealerCovered = entries.filter(
    (entry) => mix.get(entry.playerId)?.dynastyDealerValue !== null,
  ).length;
  const statsGuyCovered = entries.filter(
    (entry) => mix.get(entry.playerId)?.statsGuyValue !== null,
  ).length;
  const consensusCovered = entries.filter(
    (entry) => mix.get(entry.playerId)?.consensusValue !== null,
  ).length;
  const sources = [
    {
      key: "KTC",
      label: "KeepTradeCut",
      role: "Anchor",
      detail: "Primary Superflex / .5 PPR / no TEP valuation source.",
      status: statuses.KTC,
      covered: freshKtc,
    },
    {
      key: "TRADYR",
      label: "Tradyr",
      role: "Optional trusted secondary",
      detail: "Calibrated onto the KTC scale when complete keyed access is configured.",
      status: statuses.TRADYR,
      covered: tradyrCovered,
    },
    {
      key: "DYNASTY_DEALER",
      label: "Dynasty Dealer",
      role: "Trusted secondary",
      detail:
        "Player market calibrated onto the KTC scale; draft picks are modeled separately.",
      status: statuses.DYNASTY_DEALER,
      covered: dealerCovered,
    },
    {
      key: "STATSGUY",
      label: "Stats Guy Fantasy",
      role: "Independent fallback",
      detail:
        "No-key Sleeper-ID market checkpoint retained as an independent diagnostic; never relabeled as KTC or silently blended into the trusted consensus.",
      status: statuses.STATSGUY,
      covered: statsGuyCovered,
    },
  ] as const;
  const latestSourceStatus = new Map(
    latestRun?.marketSourceStatuses.map((row) => [row.source, row]) ?? [],
  );

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Data Health</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Production diagnostics separate market freshness, identity mapping,
          football evidence and actual league-player coverage so a green
          provider badge cannot hide a weak predictive input layer.
        </p>
      </div>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <div className="text-[9px] uppercase tracking-wide text-neutral-600">
            League ownership
          </div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">
            {owned}/{owned}
          </div>
          <div className="text-[10px] text-neutral-600">
            current Sleeper roster entries
          </div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <div className="text-[9px] uppercase tracking-wide text-neutral-600">
            Fresh KTC coverage
          </div>
          <div
            className={`mt-1 text-lg font-semibold ${freshKtc === owned ? "text-emerald-300" : "text-amber-300"}`}
          >
            {freshKtc}/{owned}
          </div>
          <div className="text-[10px] text-neutral-600">
            {owned - freshKtc} exceptions · {anyKtc} ever valued
          </div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <div className="text-[9px] uppercase tracking-wide text-neutral-600">
            Trusted blend
          </div>
          <div
            className={`mt-1 text-lg font-semibold ${consensusCovered === owned ? "text-emerald-300" : "text-neutral-200"}`}
          >
            {consensusCovered}/{owned}
          </div>
          <div className="text-[10px] text-neutral-600">
            players with fresh 2+ source consensus
          </div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <div className="text-[9px] uppercase tracking-wide text-neutral-600">
            Identity mapping
          </div>
          <div
            className={`mt-1 text-lg font-semibold ${needsReview.length ? "text-amber-300" : "text-emerald-300"}`}
          >
            {owned - needsReview.length}/{owned}
          </div>
          <div className="text-[10px] text-neutral-600">
            mapping and valuation coverage are separate
          </div>
        </div>
      </section>

      {ktcExceptions.length ? (
        <section className="rounded-lg border border-amber-900/60 bg-amber-950/15 p-4">
          <h2 className="text-sm font-semibold text-amber-100">
            KTC coverage exceptions ({ktcExceptions.length})
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-neutral-400">
            These rows are withheld from fresh-KTC totals. They are shown here
            instead of being filled with zero or silently replaced by another
            provider. Historical observations remain available where present.
          </p>
          <div className="mt-3 overflow-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="border-b border-amber-900/50 text-left text-[10px] uppercase tracking-wide text-neutral-500">
                <tr><th className="px-2 py-2">Player</th><th className="px-2 py-2">Position</th><th className="px-2 py-2">Team</th><th className="px-2 py-2">Reason</th></tr>
              </thead>
              <tbody>{ktcExceptions.map((entry) => <tr key={entry.playerId} className="border-b border-neutral-800/70 last:border-0"><td className="px-2 py-2 text-neutral-200">{entry.name}</td><td className="px-2 py-2 text-neutral-400">{entry.position}</td><td className="px-2 py-2 text-neutral-400">{entry.nflTeam ?? "—"}</td><td className="px-2 py-2 text-amber-200">{entry.reason}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">
          Weekly projection health
        </h2>
        <p className="mt-1 text-[11px] leading-5 text-neutral-500">
          The current weekly board must be generated by the consensus-v2 model.
          Old v1 rows are never counted as current. Players without a supported
          role are explicitly withheld instead of receiving invented volume.
        </p>
        {projectionData ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md bg-neutral-950 p-3">
              <div className="text-[9px] uppercase tracking-wide text-neutral-600">
                Current v2 projections
              </div>
              <div className={`mt-1 text-lg font-semibold ${projectionData.current.length ? "text-emerald-300" : "text-amber-300"}`}>
                {projectionData.current.length}
              </div>
              <div className="text-[10px] text-neutral-600">
                {projectionData.season} Week {projectionData.week}
              </div>
            </div>
            <div className="rounded-md bg-neutral-950 p-3">
              <div className="text-[9px] uppercase tracking-wide text-neutral-600">
                Explicitly withheld
              </div>
              <div className="mt-1 text-lg font-semibold text-neutral-200">
                {projectionData.unavailable.length}
              </div>
              <div className="text-[10px] text-neutral-600">
                no team / unavailable / unsupported role / already played
              </div>
            </div>
            <div className="rounded-md bg-neutral-950 p-3">
              <div className="text-[9px] uppercase tracking-wide text-neutral-600">
                External-source rows
              </div>
              <div className={`mt-1 text-lg font-semibold ${projectionData.current.some((row) => row.sourceCount > 0) ? "text-emerald-300" : "text-amber-300"}`}>
                {projectionData.current.filter((row) => row.sourceCount > 0).length}
              </div>
              <div className="text-[10px] text-neutral-600">
                player feeds plus local model; DraftKings game context is
                shown in each current projection when available
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-amber-900/60 bg-amber-950/20 p-3 text-[10px] leading-4 text-amber-200">
            Projection diagnostics are unavailable. The projection system should
            not be treated as healthy until this panel can classify the current week.
          </div>
        )}
        {projectionData && projectionData.current.length === 0 ? (
          <p className="mt-3 rounded-md border border-amber-900/50 bg-amber-950/15 p-2.5 text-[10px] leading-4 text-amber-200">
            No current consensus-v2 projections have been stored yet. Forecast
            pages remain conservatively gated until the scheduled projection
            refresh populates this week.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">
          Predictive football evidence
        </h2>
        <p className="mt-1 text-[11px] leading-5 text-neutral-500">
          These are the inputs that determine how much confidence the forecast,
          weekly lineup projection and league simulation can place on football
          performance instead of market-implied fallbacks.
        </p>
        {football ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md bg-neutral-950 p-3">
              <div className="text-[9px] uppercase tracking-wide text-neutral-600">
                Football profiles
              </div>
              <div
                className={`mt-1 text-lg font-semibold ${football.profileCoverage >= 0.9 ? "text-emerald-300" : "text-amber-300"}`}
              >
                {football.profiledPlayers}/{football.rosteredPlayers}
              </div>
              <div className="text-[10px] text-neutral-600">
                {pct(football.profileCoverage)} roster coverage
                {football.latestProfileSourceUpdatedAt
                  ? ` · source ${timeAgo(football.latestProfileSourceUpdatedAt)}`
                  : ""}
              </div>
            </div>
            <div className="rounded-md bg-neutral-950 p-3">
              <div className="text-[9px] uppercase tracking-wide text-neutral-600">
                Players with REG history
              </div>
              <div
                className={`mt-1 text-lg font-semibold ${football.gameCoverage >= 0.75 ? "text-emerald-300" : "text-amber-300"}`}
              >
                {football.playersWithRegularSeasonGames}/
                {football.rosteredPlayers}
              </div>
              <div className="text-[10px] text-neutral-600">
                {pct(football.gameCoverage)} roster coverage
                {football.latestGameObservedAt
                  ? ` · ingested ${timeAgo(football.latestGameObservedAt)}`
                  : ""}
              </div>
            </div>
            <div className="rounded-md bg-neutral-950 p-3">
              <div className="text-[9px] uppercase tracking-wide text-neutral-600">
                Decision-grade season
              </div>
              <div
                className={`mt-1 text-lg font-semibold ${football.decisionGradeCoverage >= 0.65 ? "text-emerald-300" : "text-amber-300"}`}
              >
                {football.playersWithDecisionGradeSeason}/
                {football.rosteredPlayers}
              </div>
              <div className="text-[10px] text-neutral-600">
                latest available season has ≥3 games ·{" "}
                {pct(football.decisionGradeCoverage)} coverage
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-amber-900/60 bg-amber-950/20 p-3 text-[10px] leading-4 text-amber-200">
            Football evidence diagnostics are temporarily unavailable.
            Predictive pages should still use their own evidence guards rather
            than treating missing football data as zero.
          </div>
        )}
        {football && football.decisionGradeCoverage < 0.65 ? (
          <p className="mt-3 rounded-md border border-amber-900/50 bg-amber-950/15 p-2.5 text-[10px] leading-4 text-amber-200">
            Predictive evidence remains sparse. Forecast probability and
            league-outcome outputs are intentionally shrunk or gated until
            football coverage improves; market coverage alone should not be
            interpreted as predictive-model readiness.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-neutral-950 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">
              Decision baseline
            </div>
            <div className="mt-1 text-sm font-semibold text-neutral-100">
              {formatDateEastern(ORLANDO_BASELINE_DATE)}
            </div>
            <p className="mt-1 text-[10px] text-neutral-600">
              First complete verified Orlando Oswalds checkpoint.
            </p>
          </div>
          <div className="rounded-md bg-neutral-950 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">
              Automatic refresh
            </div>
            <div className="mt-1 text-sm font-semibold text-emerald-300">
              Daily · around 8 a.m. ET
            </div>
            <p className="mt-1 text-[10px] text-neutral-600">
              {latestRun
                ? `Latest ${latestRun.status.replaceAll("_", " ").toLowerCase()} run: ${formatDateTimeEastern(latestRun.startedAt)}.`
                : "Page visits do not launch ingestion jobs."}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">
          Current market sources
        </h2>
        <p className="mt-1 text-xs leading-5 text-neutral-400">
          “Fresh” means the provider timestamp is current. Coverage shows how
          many of the {owned} rostered league players actually have a fresh
          usable observation.
        </p>
        <div className="mt-4 space-y-2">
          {sources.map((source) => {
            const runStatus = latestSourceStatus.get(source.key);
            const disabled = runStatus?.enabled === false;
            const label = disabled
              ? "Disabled"
              : source.status.stale
                ? runStatus?.ok === false
                  ? "Refresh failed"
                  : "Unavailable"
                : "Fresh";
            const labelClass = disabled
              ? "text-neutral-500"
              : source.status.stale
                ? "text-amber-300"
                : "text-emerald-300";
            return (
              <div
                key={source.key}
                className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-200">
                        {source.label}
                      </span>
                      <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neutral-500">
                        {source.role}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-neutral-500">
                      {source.detail}
                    </p>
                  </div>
                  <span className={`text-[10px] font-medium ${labelClass}`}>
                    {label}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-600">
                  <span>
                    Coverage{" "}
                    <strong
                      className={
                        source.covered === owned
                          ? "text-neutral-300"
                          : disabled
                            ? "text-neutral-600"
                            : "text-amber-300"
                      }
                    >
                      {source.covered}/{owned}
                    </strong>
                  </span>
                  <span>
                    Last provider update{" "}
                    {source.status.sourceUpdatedAt || source.status.observedAt
                      ? timeAgo(
                          source.status.sourceUpdatedAt ?? source.status.observedAt,
                        )
                      : "never"}
                  </span>
                </div>
                {disabled ? (
                  <p className="mt-2 text-[10px] leading-4 text-neutral-500">
                    {runStatus?.message ?? "Optional source disabled by configuration."}
                  </p>
                ) : source.status.stale && runStatus?.ok === false ? (
                  <p className="mt-2 text-[10px] leading-4 text-amber-300">
                    {runStatus.message}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] text-neutral-600">
          When all trusted sources qualify: KTC 60% · Tradyr 20% · Dynasty
          Dealer 20%, renormalized across the trusted sources that are actually
          available. Stats Guy is retained independently and is not used to
          manufacture KTC coverage or consensus.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">Draft data</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md bg-neutral-950 p-3">
            <div className="text-[9px] uppercase tracking-wide text-neutral-600">
              Pick market
            </div>
            <div
              className={`mt-1 text-sm font-semibold ${pickMarket && !pickMarket.stale ? "text-emerald-300" : "text-amber-300"}`}
            >
              {!pickMarket
                ? "Unavailable"
                : pickMarket.stale
                  ? "Stored / stale"
                  : "Fresh"}
            </div>
            <div className="mt-1 text-[10px] text-neutral-600">
              {pickMarket
                ? `${pickMarket.rows.length} market rows · updated ${timeAgo(pickMarket.sourceUpdatedAt)}`
                : "No verified board available"}
            </div>
          </div>
          <div className="rounded-md bg-neutral-950 p-3">
            <div className="text-[9px] uppercase tracking-wide text-neutral-600">
              Pick ownership
            </div>
            <div
              className={`mt-1 text-sm font-semibold ${pickOwnership && !pickOwnership.stale ? "text-emerald-300" : "text-amber-300"}`}
            >
              {!pickOwnership
                ? "Unavailable"
                : pickOwnership.stale
                  ? "Last known / stale"
                  : "Fresh"}
            </div>
            <div className="mt-1 text-[10px] text-neutral-600">
              {pickOwnership
                ? `${pickOwnership.rows.length} traded-pick records · checked ${timeAgo(pickOwnership.observedAt)}`
                : "Current trade math withholds picks until ownership can be verified"}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">
          Identity mapping review ({needsReview.length})
        </h2>
        <p className="mt-1 text-[10px] leading-4 text-neutral-600">
          A mapped identity can still lack a KTC price; that is reported in
          coverage above rather than silently valued at zero.
        </p>
        {needsReview.length === 0 ? (
          <p className="mt-3 text-xs text-emerald-300">
            All current roster players have resolved identities.
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-1.5 text-xs text-neutral-300 sm:grid-cols-2 lg:grid-cols-3">
            {needsReview.map((player) => (
              <li
                key={player.id}
                className="rounded bg-neutral-950 px-2.5 py-2"
              >
                {player.fullName}{" "}
                <span className="text-neutral-600">({player.position})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs text-neutral-400">
        <h2 className="mb-3 text-sm font-semibold text-neutral-100">
          Decision configuration
        </h2>
        <dl className="space-y-2">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <dt>KTC format</dt>
            <dd className="text-right text-neutral-300">{KTC_FORMAT_LABEL}</dd>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <dt>Freshness cutoff</dt>
            <dd className="text-right text-neutral-300">
              {MARKET_SOURCE_MAX_AGE_HOURS}h
            </dd>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <dt>Automatic ingestion</dt>
            <dd className="text-right text-emerald-300">
              Daily · 8 a.m. ET window
            </dd>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <dt>Public access</dt>
            <dd className="text-right text-neutral-300">Read-only</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
