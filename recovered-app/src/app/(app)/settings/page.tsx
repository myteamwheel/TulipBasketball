import KtcImportForm from "@/components/KtcImportForm";
import { getSecondaryBackupHealth } from "@/lib/secondaryBackup";
import { getPlayersNeedingMappingReview } from "@/lib/queries";
import { KTC_DIRECT_REFRESH_ENABLED, KTC_FORMAT_LABEL, MARKET_SOURCE_MAX_AGE_HOURS, SLEEPER_LEAGUE_ID, ORLANDO_OSWALDS_SLEEPER_USER_ID, STATSGUY_REFRESH_ENABLED, DYNASTYDEALER_REFRESH_ENABLED, DISPLAY_TIMEZONE } from "@/lib/config";
import { getLatestMarketSourceStatuses } from "@/lib/marketSources";
import { authRequired } from "@/lib/auth";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const secondaryBackup = await getSecondaryBackupHealth();
  const [needsReview, statuses] = await Promise.all([getPlayersNeedingMappingReview(), getLatestMarketSourceStatuses()]);
  const sources = [
    { key:"KTC" as const, enabled:KTC_DIRECT_REFRESH_ENABLED, label:"KeepTradeCut", detail:"Primary live dynasty market source · Superflex / 0.5 PPR / no TEP · freshness marker must pass the cutoff" },
    { key:"STATSGUY" as const, enabled:STATSGUY_REFRESH_ENABLED, label:"Stats Guy Fantasy", detail:"Independent daily market source · official API · translated onto KTC scale only from same-refresh overlap" },
    { key:"DYNASTYDEALER" as const, enabled:DYNASTYDEALER_REFRESH_ENABLED, label:"Dynasty Dealer", detail:"Independent real-Sleeper-trade market · public API · translated onto KTC scale and reliability-gated per player" },
  ];
  return <div className="space-y-6">
    <div><div className="eyebrow">Controls + methodology</div><h1 className="mt-1 text-xl font-semibold text-neutral-100">Settings</h1><p className="text-sm text-neutral-500">Data sources, backups, mapping review, and the technical rules behind the dashboard.</p><p className="mt-1 text-[10px] text-neutral-600">Build: PATCH 13 · preserves PATCH 11 UX + PATCH 12 recovery</p></div>

    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h3 className="mb-1 text-sm font-semibold text-neutral-100">Live market sources</h3>
      <p className="mb-3 text-xs text-neutral-400">Every visit/Refresh Data run checks each enabled source. A provider older than {MARKET_SOURCE_MAX_AGE_HOURS} hours is stored only if appropriate for audit and is excluded from the consensus pool; failed pulls never replace prior valid data.</p>
      <div className="space-y-3">{sources.map((s)=>{const st=statuses[s.key];return <div key={s.key} className="rounded border border-neutral-800 bg-neutral-950/50 p-3 text-xs"><div className="flex items-center justify-between"><span className="font-medium text-neutral-200">{s.label}</span><span className={!s.enabled?"text-neutral-500":st.stale?"text-amber-400":"text-emerald-400"}>{!s.enabled?"disabled":st.stale?"stale / no stored live value":"fresh"}</span></div><p className="mt-1 text-neutral-500">{s.detail}</p><p className="mt-1 text-neutral-600">Last observed: {timeAgo(st.observedAt)}{st.sourceUpdatedAt?` · provider data as of ${timeAgo(st.sourceUpdatedAt)}`:""}</p></div>})}</div>
      <details className="mt-3 rounded border border-neutral-800 bg-neutral-950/40 p-3 text-[11px] text-neutral-500">
        <summary className="cursor-pointer font-medium text-neutral-300">How consensus, signals, and pick values work</summary>
        <div className="mt-2 space-y-2 leading-relaxed"><p><span className="font-medium text-neutral-300">Consensus:</span> KTC is the 70% anchor. Stats Guy and Dynasty Dealer each start at 15% after same-refresh position-aware calibration onto the KTC scale. A secondary is downweighted or excluded per player when the calibration is extrapolated or it remains implausibly far from live KTC; raw source numbers are never averaged directly with KTC.</p><p><span className="font-medium text-neutral-300">Signal context:</span> Sleeper supplies roster/status/depth metadata and nflverse adds automated NFL production context when available. These inform recommendations but are not blended into market value.</p><p><span className="font-medium text-neutral-300">Draft picks:</span> KTC Early/Mid/Late pick values are saved on refresh. Transaction grades project the original pick team into a bucket from league power and include that pick value in the trade total.</p></div>
      </details><p className="mt-3 text-[10px] text-neutral-600">Third-source attribution: <a className="underline hover:text-neutral-300" href="https://www.dynastydealer.com" target="_blank" rel="noreferrer">Values by Dynasty Dealer</a>.</p>
    </div>

    <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/10 p-4 sm:p-5">
      <h3 className="mb-1 text-sm font-semibold text-neutral-100">Historical data backup</h3>
      <p className="mb-3 text-xs leading-relaxed text-neutral-400">Your live history is stored in the server-side database, not in this browser. These downloads give you an independent manual backup you can keep anywhere.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a href="/api/export?format=json" className="rounded-md bg-emerald-600 px-3 py-2 text-center text-xs font-medium text-white hover:bg-emerald-500">Download complete backup (.json)</a>
        <a href="/api/export?format=csv" className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-center text-xs font-medium text-neutral-200 hover:bg-neutral-800">Download all value history (.csv)</a>
      </div>
      <p className="mt-2 text-[10px] text-neutral-600">JSON is the lossless full backup for migration/recovery. CSV is the easiest version to open in Excel or Google Sheets.</p>
    </div>

    <div className={`rounded-lg border p-4 sm:p-5 ${secondaryBackup.ok ? "border-emerald-900/60 bg-emerald-950/10" : "border-amber-900/60 bg-amber-950/10"}`}>
      <div className="eyebrow">Disaster recovery</div>
      <h3 className="mt-1 text-sm font-semibold text-neutral-100">Independent automatic backup</h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-400">After every completed refresh, a second database receives a full recoverable copy of the dashboard history. It retains the latest copy plus 30 daily recovery points.</p>
      <p className={`mt-2 text-xs ${secondaryBackup.ok ? "text-emerald-400" : "text-amber-400"}`}>{secondaryBackup.ok ? `Healthy · last copy ${secondaryBackup.createdAt ? new Date(secondaryBackup.createdAt).toLocaleString("en-US", { timeZone: DISPLAY_TIMEZONE }) : "pending"}` : secondaryBackup.message}</p>
    </div>

    <KtcImportForm />

    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5"><h3 className="mb-1 text-sm font-semibold text-neutral-100">Mapping needed ({needsReview.length})</h3><p className="mb-3 text-xs text-neutral-400">Currently-rostered players with no confirmed KTC mapping. Direct Sleeper-ID sources can still value them; KTC name matching stays flagged rather than silently dropping a player.</p>{needsReview.length===0?<p className="text-xs text-emerald-400">All rostered players are mapped.</p>:<ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-neutral-300 sm:grid-cols-3">{needsReview.map((p)=><li key={p.id}>{p.fullName} <span className="text-neutral-600">({p.position})</span></li>)}</ul>}</div>

    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-5 text-xs text-neutral-400"><h3 className="mb-1 text-sm font-semibold text-neutral-100">Automatic daily snapshot</h3><p><span className="font-semibold text-emerald-300">8:00 AM Eastern every day</span> · Sleeper, KTC, eligible fresh secondary sources, consensus and signal data refresh server-side even if nobody opens the dashboard. Page visits still trigger their normal live refresh too.</p><p className="mt-2 text-[10px] text-neutral-600">Vercel schedules in UTC, so the project uses a DST-aware 12/13 UTC guard and records only one scheduled run per Eastern calendar day.</p></div>

    <details className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 text-xs text-neutral-400"><summary className="cursor-pointer text-sm font-semibold text-neutral-100">Technical configuration</summary><dl className="space-y-1"><div className="flex justify-between"><dt>Sleeper league ID</dt><dd className="text-neutral-300">{SLEEPER_LEAGUE_ID}</dd></div><div className="flex justify-between"><dt>Primary team (Sleeper user id)</dt><dd className="text-neutral-300">{ORLANDO_OSWALDS_SLEEPER_USER_ID}</dd></div><div className="flex justify-between"><dt>KTC value format</dt><dd className="text-neutral-300">{KTC_FORMAT_LABEL}</dd></div><div className="flex justify-between"><dt>Stale-source cutoff</dt><dd className="text-neutral-300">{MARKET_SOURCE_MAX_AGE_HOURS} hours</dd></div><div className="flex justify-between"><dt>Password protection</dt><dd className={authRequired()?"text-emerald-400":"text-amber-400"}>{authRequired()?"Enabled":"Disabled — set DASHBOARD_PASSWORD to enable"}</dd></div></dl></details>
  </div>;
}
