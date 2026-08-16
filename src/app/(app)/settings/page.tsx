import KtcImportForm from "@/components/KtcImportForm";
import { getPlayersNeedingMappingReview } from "@/lib/queries";
import { DYNASTY_DEALER_REFRESH_ENABLED, FANTASYCALC_REFRESH_ENABLED, KTC_DIRECT_REFRESH_ENABLED, KTC_FORMAT_LABEL, MARKET_SOURCE_MAX_AGE_HOURS, SLEEPER_LEAGUE_ID, ORLANDO_OSWALDS_SLEEPER_USER_ID, STATSGUY_REFRESH_ENABLED, TRADYR_REFRESH_ENABLED } from "@/lib/config";
import { getLatestMarketSourceStatuses } from "@/lib/marketSources";
import { authRequired } from "@/lib/auth";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [needsReview, statuses] = await Promise.all([getPlayersNeedingMappingReview(), getLatestMarketSourceStatuses()]);
  const sources = [
    { key:"KTC" as const, enabled:KTC_DIRECT_REFRESH_ENABLED, label:"KeepTradeCut", detail:"Gold-standard anchor · Superflex / .5 PPR / no TEP · public freshness text must pass the cutoff" },
    { key:"TRADYR" as const, enabled:TRADYR_REFRESH_ENABLED, label:"Tradyr", detail:"Trusted secondary · dynasty Superflex composite · calibrated to the KTC scale from same-refresh league overlap" },
    { key:"DYNASTY_DEALER" as const, enabled:DYNASTY_DEALER_REFRESH_ENABLED, label:"Dynasty Dealer", detail:"Trusted secondary · current player/pick market · calibrated to the KTC scale from same-refresh league overlap" },
    { key:"FANTASYCALC" as const, enabled:FANTASYCALC_REFRESH_ENABLED, label:"FantasyCalc (diagnostic)", detail:"Stored for diagnostics only; never changes the trusted consensus" },
    { key:"STATSGUY" as const, enabled:STATSGUY_REFRESH_ENABLED, label:"Stats Guy Fantasy (diagnostic)", detail:"Stored for diagnostics only; never changes the trusted consensus" },
  ];
  return <div className="space-y-6">
    <div><h1 className="text-lg font-semibold text-neutral-100">Settings</h1><p className="text-sm text-neutral-500">Data sources, freshness gates, mapping review, backups, and access configuration.</p><p className="mt-1 text-[10px] text-neutral-600">Build: Patch 15 · 2026-08-16</p></div>

    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h3 className="mb-1 text-sm font-semibold text-neutral-100">Manual data backup</h3>
      <p className="mb-4 max-w-3xl text-xs leading-5 text-neutral-400">Download the dashboard’s saved history whenever you want. The full JSON is the migration/audit backup and includes stored KTC history, all market-source observations, consensus history, roster snapshots, ownership intervals, transactions, refresh runs, signals, notes, managers, and player mappings. The CSV is the spreadsheet-friendly KTC time series.</p>
      <div className="flex flex-wrap gap-2">
        <a href="/api/export/full-history" className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500">Download complete backup (.json)</a>
        <a href="/api/export/ktc-history" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-medium text-neutral-200 hover:border-neutral-600 hover:bg-neutral-900">Download KTC history (.csv)</a>
      </div>
      <p className="mt-3 text-[10px] text-neutral-600">Exports are generated from the database at click time and are not cached. They do not contain deployment credentials or environment secrets.</p>
    </div>

    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h3 className="mb-1 text-sm font-semibold text-neutral-100">Live market sources</h3>
      <p className="mb-3 text-xs text-neutral-400">Every visit/Refresh Data run checks each enabled source. Trusted market consensus requires fresh KTC plus at least one fresh trusted secondary. Diagnostic feeds are stored for comparison but never affect the consensus. Failed pulls never replace prior valid data.</p>
      <div className="space-y-3">{sources.map((s)=>{const st=statuses[s.key];return <div key={s.key} className="rounded border border-neutral-800 bg-neutral-950/50 p-3 text-xs"><div className="flex items-center justify-between"><span className="font-medium text-neutral-200">{s.label}</span><span className={!s.enabled?"text-neutral-500":st.stale?"text-amber-400":"text-emerald-400"}>{!s.enabled?"disabled":st.stale?"stale / no stored live value":"fresh"}</span></div><p className="mt-1 text-neutral-500">{s.detail}</p><p className="mt-1 text-neutral-600">Last observed: {timeAgo(st.observedAt)}{st.sourceUpdatedAt?` · provider data as of ${timeAgo(st.sourceUpdatedAt)}`:""}</p></div>})}</div>
      <p className="mt-3 text-[11px] text-neutral-600">Consensus weights: KTC 60% · Tradyr 20% · Dynasty Dealer 20%. Trusted secondary values are converted to the KTC scale and rejected from consensus when they diverge beyond the guardrail. Remaining eligible weights are automatically re-normalized.</p>
    </div>

    <KtcImportForm />

    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5"><h3 className="mb-1 text-sm font-semibold text-neutral-100">Mapping needed ({needsReview.length})</h3><p className="mb-3 text-xs text-neutral-400">Currently-rostered players with no confirmed KTC mapping. Direct Sleeper-ID sources can still value them; KTC name matching stays flagged rather than silently dropping a player.</p>{needsReview.length===0?<p className="text-xs text-emerald-400">All rostered players are mapped.</p>:<ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-neutral-300 sm:grid-cols-3">{needsReview.map((p)=><li key={p.id}>{p.fullName} <span className="text-neutral-600">({p.position})</span></li>)}</ul>}</div>

    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 text-xs text-neutral-400"><h3 className="mb-2 text-sm font-semibold text-neutral-100">Configuration</h3><dl className="space-y-1"><div className="flex justify-between gap-4"><dt>Sleeper league ID</dt><dd className="break-all text-right text-neutral-300">{SLEEPER_LEAGUE_ID}</dd></div><div className="flex justify-between gap-4"><dt>Primary team (Sleeper user id)</dt><dd className="break-all text-right text-neutral-300">{ORLANDO_OSWALDS_SLEEPER_USER_ID}</dd></div><div className="flex justify-between gap-4"><dt>KTC value format</dt><dd className="text-right text-neutral-300">{KTC_FORMAT_LABEL}</dd></div><div className="flex justify-between gap-4"><dt>Stale-source cutoff</dt><dd className="text-right text-neutral-300">{MARKET_SOURCE_MAX_AGE_HOURS} hours</dd></div><div className="flex justify-between gap-4"><dt>Password protection</dt><dd className={authRequired()?"text-emerald-400":"text-amber-400"}>{authRequired()?"Enabled":"Disabled — set DASHBOARD_PASSWORD to enable"}</dd></div></dl></div>
  </div>;
}
