import { isOwnerAuthorized, ownerUnauthorized } from '@/lib/ownerAuth';
import { syncLeagueHistory } from '@/lib/leagueHistory';
import { preserveTradePrices } from '@/lib/preserveTradePrices';
import { recordDataHealth } from '@/lib/dataHealth';
export const maxDuration = 300;
export async function POST(request: Request) {
  if (!isOwnerAuthorized(request)) return ownerUnauthorized();
  const history = await syncLeagueHistory();
  const prices = await preserveTradePrices();
  const health = await recordDataHealth();
  return Response.json({ history, prices, alerts: health.alerts }, { headers: { 'Cache-Control': 'no-store' } });
}
