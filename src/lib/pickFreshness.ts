import type { DraftPickMarketValue } from './marketSources';
import { MARKET_SOURCE_MAX_AGE_MS } from './config';
function validRow(row: DraftPickMarketValue) {
 return Number.isFinite(row.value) && row.value > 0 && typeof row.sourceUpdatedAt === 'string' && Number.isFinite(Date.parse(row.sourceUpdatedAt));
}
export function freshPickRows(rows: DraftPickMarketValue[], now = Date.now()) {
 return rows.filter(row => validRow(row) && Date.parse(row.sourceUpdatedAt!) <= now && now - Date.parse(row.sourceUpdatedAt!) <= MARKET_SOURCE_MAX_AGE_MS);
}
/** Provider timestamps are evidence. Fetch completion is not a market observation. */
export function historicalPickSnapshots(runs: { summary: string | null }[]) {
 const groups = new Map<string, DraftPickMarketValue[]>();
 for (const run of runs) {
  try {
   const rows = JSON.parse(run.summary ?? '{}').draftPickMarket?.rows;
   if (!Array.isArray(rows)) continue;
   for (const row of rows as DraftPickMarketValue[]) {
    if (!row || !validRow(row)) continue;
    const key = new Date(row.sourceUpdatedAt!).toISOString();
    const group = groups.get(key) ?? [];
    if (!group.some(existing => existing.key === row.key && existing.label === row.label && existing.source === row.source)) group.push(row);
    groups.set(key, group);
   }
  } catch { /* Unparseable evidence cannot grade a trade. */ }
 }
 return [...groups].map(([date, rows]) => ({ observedAt: new Date(date), rows }));
}
