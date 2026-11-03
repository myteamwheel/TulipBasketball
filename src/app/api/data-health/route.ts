import { getDataHealth } from '@/lib/dataHealth';
export const dynamic = 'force-dynamic';
export async function GET() {
  const health = await getDataHealth();
  return Response.json(health, { headers: { 'Cache-Control': 'no-store' } });
}
