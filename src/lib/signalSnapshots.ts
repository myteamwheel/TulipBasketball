import type { SignalResult } from "@/lib/signals";

export type StoredSignalRow = {
  playerId: string;
  signal: string;
  score: number;
  confidence: string;
  reasonCodes: string;
};

const SIGNALS = new Set(["SELL_HIGH", "HOLD", "BUY_LOW", "CUT_BAIT", "WATCH"]);
const CONFIDENCES = new Set(["LOW", "MEDIUM", "HIGH"]);

/**
 * Use a stored refresh snapshot only when it fully covers the requested current
 * roster. A partial or malformed snapshot is rejected so callers can safely
 * fall back to a fresh calculation instead of silently omitting signals.
 */
export function materializeStoredSignalResults(
  playerIds: string[],
  rows: StoredSignalRow[],
): Map<string, SignalResult> | null {
  const requested = new Set(playerIds);
  if (!requested.size) return new Map();

  const results = new Map<string, SignalResult>();
  for (const row of rows) {
    if (!requested.has(row.playerId) || results.has(row.playerId)) return null;
    if (
      !SIGNALS.has(row.signal) ||
      !CONFIDENCES.has(row.confidence) ||
      !Number.isInteger(row.score) ||
      row.score < 0 ||
      row.score > 100
    ) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.reasonCodes);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    const reasonCodes = parsed.filter(
      (reason): reason is { code: string; label: string; detail: string } =>
        !!reason &&
        typeof reason === "object" &&
        typeof reason.code === "string" &&
        typeof reason.label === "string" &&
        typeof reason.detail === "string",
    );
    if (reasonCodes.length !== parsed.length) return null;

    results.set(row.playerId, {
      signal: row.signal as SignalResult["signal"],
      score: row.score,
      confidence: row.confidence as SignalResult["confidence"],
      reasonCodes,
    });
  }

  return results.size === requested.size ? results : null;
}
