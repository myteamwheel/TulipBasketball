const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

/** Normalizes a player name for fallback name-based matching (never the primary key). */
export function normalizePlayerName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/['’.]/g, "") // apostrophes, periods
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "") // suffixes
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
