import { prisma } from '@/lib/prisma';
import { SLEEPER_LEAGUE_ID } from './config';
import { getObservationSeries } from './metrics';
import { historicalPickSnapshots } from './pickFreshness';
import { currentPickMarketValue } from './pickValuation';
import { selectTradeSnapshot } from './tradeGrades';
import { ensureTradeHistoryStorage, getLeagueHistory, type FrozenTradePrices } from './leagueHistory';
/** Append verified evidence for previously unpriced assets. Existing saved prices never change. */
export async function preserveTradePrices() {
  await ensureTradeHistoryStorage();
  const history = await getLeagueHistory();
  const trades = history.seasons.flatMap(s => s.trades);
  const ids = [...new Set(trades.flatMap(t => [...Object.keys(t.adds ?? {}), ...Object.keys(t.drops ?? {})]))];
  const players = await prisma.player.findMany({ where: { sleeperId: { in: ids } }, select: { id: true, sleeperId: true } });
  const [series, runs] = await Promise.all([getObservationSeries(players.map(p => p.id)), prisma.refreshRun.findMany({ where: { league: { sleeperId: SLEEPER_LEAGUE_ID }, summary: { not: null } }, select: { startedAt: true, finishedAt: true, summary: true }, orderBy: { startedAt: 'desc' } })]);
  const internalIds = new Map(players.map(p => [p.sleeperId, p.id]));
  const picks = historicalPickSnapshots(runs);
  let pricedAssets = 0;
  for (const trade of trades) {
    const prices: FrozenTradePrices = {};
    for (const pid of new Set([...Object.keys(trade.adds ?? {}), ...Object.keys(trade.drops ?? {})])) {
      const id = internalIds.get(pid);
      if (!id) continue;
      const value = selectTradeSnapshot(series.get(id) ?? [], new Date(trade.created), row => row.validationStatus === 'VALID');
      if (value) prices[id] = { value: value.snapshot.value, observedAt: value.snapshot.observedAt.toISOString(), timing: value.timing };
    }
    for (const pick of trade.draft_picks as { season: string; round: number; roster_id: number }[]) {
      const value = selectTradeSnapshot(picks, new Date(trade.created), row => currentPickMarketValue(row.rows, Number(pick.season), pick.round, null) !== null);
      if (value) prices[`pick:${pick.season}:${pick.round}:${pick.roster_id}`] = { value: currentPickMarketValue(value.snapshot.rows, Number(pick.season), pick.round, null)!, observedAt: value.snapshot.observedAt.toISOString(), timing: value.timing };
    }
    if (!Object.keys(prices).length) continue;
    await prisma.$executeRaw`INSERT INTO "TradeHistoryArchive" (id, body) VALUES (${'prices:' + trade.transaction_id}, ${JSON.stringify(prices)}::jsonb) ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body || "TradeHistoryArchive".body`;
    pricedAssets += Object.keys(prices).length;
  }
  return { tradesChecked: trades.length, pricedAssets };
}
