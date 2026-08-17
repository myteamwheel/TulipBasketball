import { getAllCurrentRosterEntries, getPlayersNeedingMappingReview } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";
import { KTC_FORMAT_LABEL, MARKET_SOURCE_MAX_AGE_HOURS, ORLANDO_BASELINE_DATE } from "@/lib/config";
import { getLatestMarketSourceStatuses } from "@/lib/marketSources";
import { fetchDraftPickMarketForCapital } from "@/lib/pickMarket";
import { fetchTradedPickOwnershipState } from "@/lib/pickOwnership";
import { getFootballCoverage } from "@/lib/footballCoverage";
import { formatDateEastern, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const pct = (value: number) => {
  const bounded = Math.max(0, Math.min(1, value)) * 100;
  if (bounded === 0 || bounded === 100) return `${Math.round(bounded)}%`;
  return `${bounded.toFixed(1)}%`;
};

export default async function SettingsPage() {
  const [needsReview, statuses, entries, pickMarket, pickOwnership, football] = await Promise.all([
    getPlayersNeedingMappingReview(),
    getLatestMarketSourceStatuses(),
    getAllCurrentRosterEntries(),
    fetchDraftPickMarketForCapital().catch(() => null),
    fetchTradedPickOwnershipState().catch(() => null),
    getFootballCoverage().catch(() => null),
  ]);
  const ids = entries.map((entry) => entry.playerId);
  const [market, mix] = await Promise.all([computeMarketDataForPlayers(ids), getFreshCurrentMarketMix(ids)]);
  const owned = entries.length;
  const freshKtc = entries.filter((entry) => {
    const row = market.get(entry.playerId);
    return !!row && !row.isStale && row.currentValue !== null;
  }).length;
  const anyKtc = entries.filter((entry) => market.get(entry.playerId)?.currentValue !== null).length;
  const tradyrCovered = entries.filter((entry) => mix.get(entry.playerId)?.tradyrValue !== null).length;
  const dealerCovered = entries.filter((entry) => mix.get(entry.playerId)?.dynastyDealerValue !== null).length;
  const consensusCovered = entries.filter((entry) => mix.get(entry.playerId)?.consensusValue !== null).length;
  const sources = [
    { key: "KTC", label: "KeepTradeCut", role: "Anchor", detail: "Primary Superflex / .5 PPR / no TEP valuation source.", status: statuses.KTC, covered: freshKtc },
    { key: "TRADYR", label: "Tradyr", role: "Trusted secondary", detail: "Calibrated onto the KTC scale from same-refresh league overlap.", status: statuses.TRADYR, covered: tradyrCovered },
    { key: "DYNASTY_DEALER", label: "Dynasty Dealer", role: "Trusted secondary", detail: "Player market calibrated onto the KTC scale; draft picks are modeled separately.", status: statuses.DYNASTY_DEALER, covered: dealerCovered },
  ] as const;

  return <div className="min-w-0 space-y-6">
    <div>
      <h1 className="text-xl font-semibold text-neutral-100">Data Health</h1>
      <p className="mt-1 text-sm text-neutral-500">Production diagnostics separate market freshness, identity mapping, football evidence and actual league-player coverage so a green provider badge cannot hide a weak predictive input layer.</p>
    </div>

    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><div className="text-[9px] uppercase tracking-wide text-neutral-600">League ownership</div><div className="mt-1 text-lg font-semibold text-neutral-100">{owned}/{owned}</div><div className="text-[10px] text-neutral-600">current Sleeper roster entries</div></div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><div className="text-[9px] uppercase tracking-wide text-neutral-600">Fresh KTC coverage</div><div className={`mt-1 text-lg font-semibold ${freshKtc === owned ? "text-emerald-300" : "text-amber-300"}`}>{freshKtc}/{owned}</div><div className="text-[10px] text-neutral-600">{owned - freshKtc} unavailable/stale · {anyKtc} ever valued</div></div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><div className="text-[9px] uppercase tracking-wide text-neutral-600">Trusted blend</div><div className={`mt-1 text-lg font-semibold ${consensusCovered === owned ? "text-emerald-300" : "text-neutral-200"}`}>{consensusCovered}/{owned}</div><div className="text-[10px] text-neutral-600">players with fresh 2+ source consensus</div></div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><div className="text-[9px] uppercase tracking-wide text-neutral-600">Identity mapping</div><div className={`mt-1 text-lg font-semibold ${needsReview.length ? "text-amber-300" : "text-emerald-300"}`}>{owned - needsReview.length}/{owned}</div><div className="text-[10px] text-neutral-600">mapping and valuation coverage are separate</div></div>
    </section>

    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-sm font-semibold text-neutral-100">Predictive football evidence</h2>
      <p className="mt-1 text-[11px] leading-5 text-neutral-500">These are the inputs that determine how much confidence the forecast, weekly lineup projection and league simulation can place on football performance instead of market-implied fallbacks.</p>
      {football ? <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md bg-neutral-950 p-3"><div className="text-[9px] uppercase tracking-wide text-neutral-600">Football profiles</div><div className={`mt-1 text-lg font-semibold ${football.profileCoverage >= .9 ? "text-emerald-300" : "text-amber-300"}`}>{football.profiledPlayers}/{football.rosteredPlayers}</div><div className="text-[10px] text-neutral-600">{pct(football.profileCoverage)} roster coverage{football.latestProfileSourceUpdatedAt ? ` · source ${timeAgo(football.latestProfileSourceUpdatedAt)}` : ""}</div></div>
        <div className="rounded-md bg-neutral-950 p-3"><div className="text-[9px] uppercase tracking-wide text-neutral-600">Players with REG history</div><div className={`mt-1 text-lg font-semibold ${football.gameCoverage >= .75 ? "text-emerald-300" : "text-amber-300"}`}>{football.playersWithRegularSeasonGames}/{football.rosteredPlayers}</div><div className="text-[10px] text-neutral-600">{pct(football.gameCoverage)} roster coverage{football.latestGameObservedAt ? ` · ingested ${timeAgo(football.latestGameObservedAt)}` : ""}</div></div>
        <div className="rounded-md bg-neutral-950 p-3"><div className="text-[9px] uppercase tracking-wide text-neutral-600">Decision-grade season</div><div className={`mt-1 text-lg font-semibold ${football.decisionGradeCoverage >= .65 ? "text-emerald-300" : "text-amber-300"}`}>{football.playersWithDecisionGradeSeason}/{football.rosteredPlayers}</div><div className="text-[10px] text-neutral-600">latest available season has ≥3 games · {pct(football.decisionGradeCoverage)} coverage</div></div>
      </div> : <div className="mt-3 rounded-md border border-amber-900/60 bg-amber-950/20 p-3 text-[10px] leading-4 text-amber-200">Football evidence diagnostics are temporarily unavailable. Predictive pages should still use their own evidence guards rather than treating missing football data as zero.</div>}
      {football && football.decisionGradeCoverage < .65 ? <p className="mt-3 rounded-md border border-amber-900/50 bg-amber-950/15 p-2.5 text-[10px] leading-4 text-amber-200">Predictive evidence remains sparse. Forecast probability and league-outcome outputs are intentionally shrunk or gated until football coverage improves; market coverage alone should not be interpreted as predictive-model readiness.</p> : null}
    </section>

    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md bg-neutral-950 p-3"><div className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">Decision baseline</div><div className="mt-1 text-sm font-semibold text-neutral-100">{formatDateEastern(ORLANDO_BASELINE_DATE)}</div><p className="mt-1 text-[10px] text-neutral-600">First complete verified Orlando checkpoint.</p></div><div className="rounded-md bg-neutral-950 p-3"><div className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">Automatic refresh</div><div className="mt-1 text-sm font-semibold text-emerald-300">Daily · around 8 a.m. ET</div><p className="mt-1 text-[10px] text-neutral-600">Page visits do not launch ingestion jobs.</p></div></div></section>

    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"><h2 className="text-sm font-semibold text-neutral-100">Current market sources</h2><p className="mt-1 text-xs leading-5 text-neutral-400">“Fresh” means the provider timestamp is current. Coverage shows how many of the {owned} rostered league players actually have a fresh usable observation.</p><div className="mt-4 space-y-2">{sources.map((source) => <div key={source.key} className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-neutral-200">{source.label}</span><span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neutral-500">{source.role}</span></div><p className="mt-1 text-[11px] leading-4 text-neutral-500">{source.detail}</p></div><span className={`text-[10px] font-medium ${source.status.stale ? "text-amber-300" : "text-emerald-300"}`}>{source.status.stale ? "Unavailable" : "Fresh"}</span></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-600"><span>Coverage <strong className={source.covered === owned ? "text-neutral-300" : "text-amber-300"}>{source.covered}/{owned}</strong></span><span>Last provider update {timeAgo(source.status.sourceUpdatedAt ?? source.status.observedAt)}</span></div></div>)}</div><p className="mt-3 text-[10px] text-neutral-600">When all qualify: KTC 60% · Tradyr 20% · Dynasty Dealer 20%. A secondary outside the divergence guard is excluded player-by-player.</p></section>

    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"><h2 className="text-sm font-semibold text-neutral-100">Draft data</h2><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-md bg-neutral-950 p-3"><div className="text-[9px] uppercase tracking-wide text-neutral-600">Pick market</div><div className={`mt-1 text-sm font-semibold ${pickMarket && !pickMarket.stale ? "text-emerald-300" : "text-amber-300"}`}>{!pickMarket ? "Unavailable" : pickMarket.stale ? "Stored / stale" : "Fresh"}</div><div className="mt-1 text-[10px] text-neutral-600">{pickMarket ? `${pickMarket.rows.length} market rows · updated ${timeAgo(pickMarket.sourceUpdatedAt)}` : "No verified board available"}</div></div><div className="rounded-md bg-neutral-950 p-3"><div className="text-[9px] uppercase tracking-wide text-neutral-600">Pick ownership</div><div className={`mt-1 text-sm font-semibold ${pickOwnership && !pickOwnership.stale ? "text-emerald-300" : "text-amber-300"}`}>{!pickOwnership ? "Unavailable" : pickOwnership.stale ? "Last known / stale" : "Fresh"}</div><div className="mt-1 text-[10px] text-neutral-600">{pickOwnership ? `${pickOwnership.rows.length} traded-pick records · checked ${timeAgo(pickOwnership.observedAt)}` : "Current trade math withholds picks until ownership can be verified"}</div></div></div></section>

    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"><h2 className="text-sm font-semibold text-neutral-100">Identity mapping review ({needsReview.length})</h2><p className="mt-1 text-[10px] leading-4 text-neutral-600">A mapped identity can still lack a KTC price; that is reported in coverage above rather than silently valued at zero.</p>{needsReview.length === 0 ? <p className="mt-3 text-xs text-emerald-300">All current roster players have resolved identities.</p> : <ul className="mt-3 grid grid-cols-1 gap-1.5 text-xs text-neutral-300 sm:grid-cols-2 lg:grid-cols-3">{needsReview.map((player) => <li key={player.id} className="rounded bg-neutral-950 px-2.5 py-2">{player.fullName} <span className="text-neutral-600">({player.position})</span></li>)}</ul>}</section>

    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs text-neutral-400"><h2 className="mb-3 text-sm font-semibold text-neutral-100">Decision configuration</h2><dl className="space-y-2"><div className="grid grid-cols-[1fr_auto] gap-3"><dt>KTC format</dt><dd className="text-right text-neutral-300">{KTC_FORMAT_LABEL}</dd></div><div className="grid grid-cols-[1fr_auto] gap-3"><dt>Freshness cutoff</dt><dd className="text-right text-neutral-300">{MARKET_SOURCE_MAX_AGE_HOURS}h</dd></div><div className="grid grid-cols-[1fr_auto] gap-3"><dt>Automatic ingestion</dt><dd className="text-right text-emerald-300">Daily · 8 a.m. ET window</dd></div><div className="grid grid-cols-[1fr_auto] gap-3"><dt>Public access</dt><dd className="text-right text-neutral-300">Read-only</dd></div></dl></section>
  </div>;
}