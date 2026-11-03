import { cache } from 'react';
import { prisma } from './prisma';
import { SLEEPER_LEAGUE_ID, MARKET_SOURCE_MAX_AGE_MS } from './config';
import { getLatestMarketSourceStatuses } from './marketSources';
import { getLeagueHistory, ensureTradeHistoryStorage } from './leagueHistory';
import { integrityAlerts, tradeTransferIsValid } from './dataIntegrity';
export const getDataHealth = cache(async () => {
  const [sync, owners, prices, sources, history, currentTrades] = await Promise.all([
    prisma.refreshRun.findFirst({ where: { league: { sleeperId: SLEEPER_LEAGUE_ID }, sleeperSyncOk: true, finishedAt: { not: null } }, orderBy: { startedAt: 'desc' }, select: { id: true, finishedAt: true } }),
    prisma.ownershipInterval.findMany({ where: { validTo: null, manager: { isActive: true, league: { sleeperId: SLEEPER_LEAGUE_ID } } }, select: { playerId: true } }),
    prisma.ktcObservation.findMany({ where: { validationStatus: 'VALID', value: { gt: 0 }, observedAt: { gte: new Date(Date.now() - MARKET_SOURCE_MAX_AGE_MS), lte: new Date() } }, distinct: ['playerId'], select: { playerId: true, observedAt: true }, orderBy: { observedAt: 'desc' } }),
    getLatestMarketSourceStatuses(), getLeagueHistory(),
    prisma.transaction.findMany({ where: { type: 'trade', league: { sleeperId: SLEEPER_LEAGUE_ID } }, select: { sleeperTransactionId: true, rawPayload: true } }),
  ]);
  const uniqueOwners = new Set(owners.map(p => p.playerId));
  const currentCoverage = prices.filter(p => uniqueOwners.has(p.playerId)).length;
  let priorCoverage: number | null = null;
  try {
    const rows = await prisma.$queryRaw<{ body: { currentCoverage: number } }[]>`SELECT body FROM "TradeHistoryArchive" WHERE id LIKE 'health:%' AND id <> ${'health:' + (sync?.id ?? '')} ORDER BY "observedAt" DESC LIMIT 1`;
    priorCoverage = rows[0]?.body.currentCoverage ?? null;
  } catch { /* First baseline will be recorded by the next refresh. */ }
  const ledger = new Map(history.seasons.flatMap(s => s.trades).map(t => [t.transaction_id, t]));
  let invalidJson = 0;
  for (const t of currentTrades) { try { ledger.set(t.sleeperTransactionId, JSON.parse(t.rawPayload)); } catch { invalidJson++; } }
  const invalidTrades = invalidJson + [...ledger.values()].filter(t => { try { return !tradeTransferIsValid(t); } catch { return true; } }).length;
  const alerts = integrityAlerts({ now: Date.now(), lastSync: sync?.finishedAt?.toISOString() ?? null, currentCoverage, priorCoverage, duplicatePlayers: owners.length - uniqueOwners.size, invalidTrades });
  for (const key of ['KTC', 'DYNASTY_DEALER', 'STATSGUY'] as const) if (sources[key].stale) alerts.push({ code: 'STALE_SOURCE_' + key, severity: key === 'KTC' ? 'error' : 'warning', message: key + ' is stale or unavailable; excluded from fresh decisions.' });
  if (!history.chainComplete) alerts.push({ code: 'PARTIAL_HISTORY', severity: 'warning', message: 'Some linked seasons have incomplete transaction coverage.' });
  return { checkedAt: new Date().toISOString(), syncId: sync?.id ?? null, lastSync: sync?.finishedAt?.toISOString() ?? null, marketAt: prices[0]?.observedAt.toISOString() ?? null, rostered: uniqueOwners.size, currentCoverage, priorCoverage, invalidTrades, duplicatePlayers: owners.length - uniqueOwners.size, alerts, historyCheckedAt: history.checkedAt, historySeasons: history.seasons.length, historyTrades: ledger.size };
});
export async function recordDataHealth() {
  const health = await getDataHealth();
  await ensureTradeHistoryStorage();
  await prisma.$executeRaw`INSERT INTO "TradeHistoryArchive" (id, body) VALUES (${'health:' + (health.syncId ?? health.checkedAt)}, ${JSON.stringify(health)}::jsonb) ON CONFLICT (id) DO NOTHING`;
  if (health.alerts.some(a => a.severity === 'error')) console.error('Dashboard integrity checks:', JSON.stringify(health.alerts));
  return health;
}
