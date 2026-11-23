import type { Quote } from "./draftGrades";

type ArchivedPick = { playerId: string; profile: string | null; now: Quote | null };

/** The daily draft archive is keyed by Sleeper identity and an independently matched KTC profile. */
export function recentDraftTradeQuotes(picks: ArchivedPick[], asOf: Date): Map<string, Quote> {
  const result = new Map<string, Quote>();
  const today = Date.parse(asOf.toISOString().slice(0, 10) + "T00:00:00Z");
  for (const pick of picks) {
    const quote = pick.now;
    if (!pick.playerId || !/^https:\/\/keeptradecut\.com\/dynasty-rankings\/players\/[^/]+-\d+$/.test(pick.profile ?? "") ||
        !quote || !/^\d{4}-\d{2}-\d{2}$/.test(quote.date) ||
        !Number.isInteger(quote.value) || quote.value <= 0 || quote.value > 9999) continue;
    const observed = Date.parse(quote.date + "T00:00:00Z");
    if (!Number.isFinite(observed) || observed > today || today - observed > 2 * 86400000) continue;
    const previous = result.get(pick.playerId);
    if (!previous || quote.date > previous.date) result.set(pick.playerId, quote);
  }
  return result;
}
