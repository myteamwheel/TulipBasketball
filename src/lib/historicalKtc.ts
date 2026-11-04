/** KTC chart dates have day precision; never present them as intraday observations. */
export type DailyTradePrice = { value: number; date: string; sourceUrls: string[]; method: 'PRIOR_DAY_KTC' | 'ARCHIVED_KTC_PLAYER' | 'ARCHIVED_KTC_ROUND_AVERAGE' | 'KTC_ROUND_AVERAGE' };
export type RecoveredTradePrices = { fetchedAt: string; prices: Record<string, Record<string, DailyTradePrice>>; matchedPlayers: number; missingPlayers: string[]; failures: string[] };
export function priorDayPrice(rows: { d: string; v: number }[], tradeAt: number, sourceUrls: string[]): DailyTradePrice | null {
  // Use the preceding UTC calendar date. No same-day closing price/lookahead.
  const date = new Date(tradeAt - 86400000).toISOString().slice(0, 10);
  const compressed = date.slice(2).replaceAll('-', '');
  const matches = rows.filter(row => row.d === compressed && Number.isFinite(row.v) && row.v > 0 && row.v <= 9999);
  if (matches.length !== 1) return null;
  return { value: matches[0].v, date, sourceUrls, method: 'PRIOR_DAY_KTC' };
}
export function parseKtcDailyHistory(html: string, expectedId: number): { d: string; v: number }[] {
  const identity = html.match(/var player = (\{[^\n]+\});/);
  if (!identity || JSON.parse(identity[1]).playerID !== expectedId) throw new Error('KTC player identity mismatch');
  const data = html.match(/<script[^>]+id="pd-superflex"[^>]*>([\s\S]*?)<\/script>/);
  if (!data) throw new Error('KTC Superflex history absent');
  const rows = JSON.parse(data[1]).overallValue;
  if (!Array.isArray(rows) || rows.some(row => !/^\d{6}$/.test(row.d) || typeof row.v !== 'number')) throw new Error('Invalid KTC daily price series');
  return rows;
}
