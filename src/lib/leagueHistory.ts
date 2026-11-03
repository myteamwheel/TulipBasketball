import seed from '@/data/league-history.json';
import { prisma } from '@/lib/prisma';
import { SLEEPER_LEAGUE_ID } from '@/lib/config';
import { fetchLeagueHistory, type LeagueHistory } from './leagueHistorySource';
let ready: Promise<void> | undefined;
export function ensureTradeHistoryStorage() {
  return ready ??= prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TradeHistoryArchive" (id text PRIMARY KEY, body jsonb NOT NULL, "observedAt" timestamptz NOT NULL DEFAULT now())`).then(() => undefined).catch(e => { ready = undefined; throw e; });
}
export async function getLeagueHistory(): Promise<LeagueHistory> {
  try {
    const rows = await prisma.$queryRaw<{ body: LeagueHistory }[]>`SELECT body FROM "TradeHistoryArchive" WHERE id = ${'league:' + SLEEPER_LEAGUE_ID}`;
    if (rows[0]?.body.rootLeagueId === SLEEPER_LEAGUE_ID) return rows[0].body;
  } catch { /* The verified bundled archive is available before the first scheduled import. */ }
  return seed as unknown as LeagueHistory;
}
export async function syncLeagueHistory() {
  const history = await fetchLeagueHistory(SLEEPER_LEAGUE_ID);
  // Incomplete fetches must never replace the last complete season chain.
  if (!history.chainComplete) throw new Error('Historical league fetch incomplete; last verified archive preserved.');
  await ensureTradeHistoryStorage();
  await prisma.$executeRaw`INSERT INTO "TradeHistoryArchive" (id, body) VALUES (${'league:' + SLEEPER_LEAGUE_ID}, ${JSON.stringify(history)}::jsonb) ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, "observedAt" = now()`;
  return { seasons: history.seasons.length, trades: history.seasons.reduce((n, s) => n + s.trades.length, 0), checkedAt: history.checkedAt };
}
export type FrozenTradePrices = Record<string, { value: number; observedAt: string; timing: 'AT_OR_BEFORE' | 'NEXT_DAY_APPROXIMATION' }>;
export async function getFrozenTradePrices(): Promise<Map<string, FrozenTradePrices>> {
  try {
    const rows = await prisma.$queryRaw<{ id: string; body: FrozenTradePrices }[]>`SELECT id, body FROM "TradeHistoryArchive" WHERE id LIKE 'prices:%'`;
    return new Map(rows.map(row => [row.id.slice(7), row.body]));
  } catch { return new Map(); }
}
