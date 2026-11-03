export type IntegrityAlert = { code: string; severity: 'warning' | 'error'; message: string };
export function integrityAlerts(input: { now: number; lastSync: string | null; currentCoverage: number; priorCoverage: number | null; duplicatePlayers: number; invalidTrades: number }): IntegrityAlert[] {
  const alerts: IntegrityAlert[] = [];
  const age = input.lastSync ? input.now - Date.parse(input.lastSync) : Infinity;
  if (!Number.isFinite(age) || age > 32 * 3600000) alerts.push({ code: 'STALE_SYNC', severity: 'error', message: 'The last confirmed roster sync is more than 32 hours old or unavailable.' });
  if (input.priorCoverage !== null && input.priorCoverage > 0 && input.currentCoverage < input.priorCoverage * .8) alerts.push({ code: 'COVERAGE_DROP', severity: 'error', message: `Usable KTC coverage fell from ${input.priorCoverage} to ${input.currentCoverage} players (more than 20%).` });
  if (input.duplicatePlayers) alerts.push({ code: 'DUPLICATE_OWNERSHIP', severity: 'error', message: `${input.duplicatePlayers} players have conflicting open ownership records.` });
  if (input.invalidTrades) alerts.push({ code: 'INCOMPLETE_TRADE', severity: 'error', message: `${input.invalidTrades} trades have inconsistent or missing asset-transfer records.` });
  return alerts;
}
export function tradeTransferIsValid(tx: { adds: Record<string, number> | null; drops: Record<string, number> | null; draft_picks: unknown[]; waiver_budget: unknown[]; roster_ids: number[] }) {
  const ids = new Set(tx.roster_ids);
  const adds = tx.adds ?? {}, drops = tx.drops ?? {};
  const players = new Set([...Object.keys(adds), ...Object.keys(drops)]);
  if (ids.size < 2 || !players.size && !tx.draft_picks.length && !tx.waiver_budget.length) return false;
  for (const player of players) if (!ids.has(adds[player]) || !ids.has(drops[player]) || adds[player] === drops[player]) return false;
  for (const raw of tx.draft_picks) {
    const p = raw as { owner_id?: number; previous_owner_id?: number; season?: string; round?: number };
    if (!ids.has(p.owner_id!) || !ids.has(p.previous_owner_id!) || p.owner_id === p.previous_owner_id || !/^20\d{2}$/.test(String(p.season)) || !Number.isInteger(p.round) || p.round! < 1) return false;
  }
  for (const raw of tx.waiver_budget) {
    const p = raw as { sender?: number; receiver?: number; amount?: number };
    if (!ids.has(p.sender!) || !ids.has(p.receiver!) || p.sender === p.receiver || !Number.isFinite(p.amount) || p.amount! < 0) return false;
  }
  return true;
}
