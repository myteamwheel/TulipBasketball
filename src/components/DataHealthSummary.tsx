import Link from 'next/link';
import { getDataHealth } from '@/lib/dataHealth';
import { formatDateTimeEastern } from '@/lib/format';
export default async function DataHealthSummary() {
  const health = await getDataHealth();
  return <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"><h2 className="text-base font-semibold">Automatic integrity checks</h2><p className="section-freshness">Checked {formatDateTimeEastern(health.checkedAt)} · {health.currentCoverage}/{health.rostered} fresh KTC · {health.historySeasons} historical seasons</p>{health.alerts.length ? <ul className="space-y-2 text-sm">{health.alerts.map(a => <li key={a.code} className={a.severity === 'error' ? 'text-red-300' : 'text-amber-300'}>{a.message}</li>)}</ul> : <p className="text-sm text-emerald-300">No stalled roster feed, sudden coverage drop, duplicate ownership, or inconsistent trade transfers detected.</p>}<p className="mt-2 text-xs text-neutral-500">Coverage drops compare with the previous saved refresh. The scheduled production check fails on errors; optional-source warnings remain visible here.</p><Link href="/refresh-history" className="inline-block py-2 text-sm text-emerald-300">Refresh history →</Link></section>;
}
