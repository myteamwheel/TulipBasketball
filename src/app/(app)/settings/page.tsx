import KtcImportForm from "@/components/KtcImportForm";
import { getPlayersNeedingMappingReview } from "@/lib/queries";
import {
  DYNASTY_DEALER_REFRESH_ENABLED,
  FANTASYCALC_REFRESH_ENABLED,
  KTC_DIRECT_REFRESH_ENABLED,
  KTC_FORMAT_LABEL,
  MARKET_SOURCE_MAX_AGE_HOURS,
  SLEEPER_LEAGUE_ID,
  ORLANDO_OSWALDS_SLEEPER_USER_ID,
  STATSGUY_REFRESH_ENABLED,
  TRADYR_REFRESH_ENABLED,
} from "@/lib/config";
import { getLatestMarketSourceStatuses } from "@/lib/marketSources";
import { authRequired } from "@/lib/auth";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [needsReview, statuses] = await Promise.all([
    getPlayersNeedingMappingReview(),
    getLatestMarketSourceStatuses(),
  ]);

  const sources = [
    {
      key: "KTC" as const,
      enabled: KTC_DIRECT_REFRESH_ENABLED,
      label: "KeepTradeCut",
      role: "Anchor",
      detail: "Primary valuation source · Superflex / .5 PPR / no TEP · must pass freshness validation.",
    },
    {
      key: "TRADYR" as const,
      enabled: TRADYR_REFRESH_ENABLED,
      label: "Tradyr",
      role: "Trusted secondary",
      detail: "Dynasty Superflex composite, calibrated onto the KTC scale from same-refresh league overlap.",
    },
    {
      key: "DYNASTY_DEALER" as const,
      enabled: DYNASTY_DEALER_REFRESH_ENABLED,
      label: "Dynasty Dealer",
      role: "Trusted secondary",
      detail: "Player and draft-pick market, calibrated onto the KTC scale from same-refresh league overlap.",
    },
    {
      key: "FANTASYCALC" as const,
      enabled: FANTASYCALC_REFRESH_ENABLED,
      label: "FantasyCalc",
      role: "Diagnostic only",
      detail: "Stored for comparison and troubleshooting; never changes the trusted consensus.",
    },
    {
      key: "STATSGUY" as const,
      enabled: STATSGUY_REFRESH_ENABLED,
      label: "Stats Guy Fantasy",
      role: "Diagnostic only",
      detail: "Stored for comparison and troubleshooting; never changes the trusted consensus.",
    },
  ];

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Settings</h1>
        <p className="mt-1 text-sm text-neutral-500">Data sources, mappings, backups, and access configuration.</p>
      </div>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-neutral-100">Manual data backup</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-400">
          Download the data currently stored by the dashboard. The JSON is the full audit/migration backup; the CSV is a spreadsheet-friendly KTC history export.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <a href="/api/export/full-history" className="rounded-md bg-emerald-700 px-3 py-2 text-center text-xs font-medium text-white hover:bg-emerald-600">Complete backup (.json)</a>
          <a href="/api/export/ktc-history" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-center text-xs font-medium text-neutral-200 hover:border-neutral-600">KTC history (.csv)</a>
        </div>
        <p className="mt-3 text-[10px] leading-4 text-neutral-600">Generated from the database at click time. Deployment credentials and environment secrets are not included.</p>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-neutral-100">Market sources</h2>
        <p className="mt-1 text-xs leading-5 text-neutral-400">
          KTC is the anchor. A trusted consensus is published only when KTC is fresh and at least one trusted secondary is also fresh and passes the divergence guardrail.
        </p>
        <div className="mt-4 space-y-2">
          {sources.map((source) => {
            const status = statuses[source.key];
            return (
              <div key={source.key} className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-200">{source.label}</span>
                      <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neutral-500">{source.role}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-neutral-500">{source.detail}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-medium ${!source.enabled ? "text-neutral-600" : status.stale ? "text-amber-300" : "text-emerald-300"}`}>
                    {!source.enabled ? "Disabled" : status.stale ? "Stale / unavailable" : "Fresh"}
                  </span>
                </div>
                <p className="mt-2 text-[10px] text-neutral-600">
                  Last pull {timeAgo(status.observedAt)}{status.sourceUpdatedAt ? ` · provider timestamp ${timeAgo(status.sourceUpdatedAt)}` : ""}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] leading-4 text-neutral-600">Configured blend when all trusted feeds qualify: KTC 60% · Tradyr 20% · Dynasty Dealer 20%. Eligible weights re-normalize automatically when a trusted secondary is excluded.</p>
      </section>

      <KtcImportForm />

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-neutral-100">Mapping review ({needsReview.length})</h2>
        <p className="mt-1 text-xs leading-5 text-neutral-400">Current Sleeper-rostered players without a confirmed KTC identity mapping. They stay visible instead of being silently omitted.</p>
        {needsReview.length === 0 ? (
          <p className="mt-3 text-xs text-emerald-300">All current roster players are mapped.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-1.5 text-xs text-neutral-300 sm:grid-cols-2 lg:grid-cols-3">
            {needsReview.map((p) => <li key={p.id} className="rounded bg-neutral-950 px-2.5 py-2">{p.fullName} <span className="text-neutral-600">({p.position})</span></li>)}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs text-neutral-400 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-neutral-100">Configuration</h2>
        <dl className="space-y-2">
          <div className="grid grid-cols-[1fr_auto] gap-3"><dt>Sleeper league</dt><dd className="max-w-[55vw] break-all text-right text-neutral-300">{SLEEPER_LEAGUE_ID}</dd></div>
          <div className="grid grid-cols-[1fr_auto] gap-3"><dt>Primary Sleeper user</dt><dd className="max-w-[55vw] break-all text-right text-neutral-300">{ORLANDO_OSWALDS_SLEEPER_USER_ID}</dd></div>
          <div className="grid grid-cols-[1fr_auto] gap-3"><dt>KTC format</dt><dd className="text-right text-neutral-300">{KTC_FORMAT_LABEL}</dd></div>
          <div className="grid grid-cols-[1fr_auto] gap-3"><dt>Freshness cutoff</dt><dd className="text-right text-neutral-300">{MARKET_SOURCE_MAX_AGE_HOURS}h</dd></div>
          <div className="grid grid-cols-[1fr_auto] gap-3"><dt>Password protection</dt><dd className={authRequired() ? "text-emerald-300" : "text-amber-300"}>{authRequired() ? "Enabled" : "Disabled"}</dd></div>
        </dl>
      </section>
    </div>
  );
}
