import { calculateTradeSideGrades } from "./tradeGrades";
import { currentOutcomeGrade, type ReviewAsset, type ReviewTrade } from "./tradeReview";

type Snapshot = { asOf: string; players: Map<string, number>; picks: Map<string, number> };
type Value = { sf_dynasty?: number };
type PlayerRow = { id?: string; value?: Value };
type PickRow = { year?: number; round?: number; variant?: string; value?: Value };
type Board<T> = { total?: number; valuesAsOf?: { sf_dynasty?: string }; players?: T[]; picks?: T[] };

/** Refuse a stale, truncated or internally inconsistent provider snapshot. */
export function parseStatsGuySnapshot(playersRaw: unknown, picksRaw: unknown, now = new Date(), minimumPlayers = 300): Snapshot | null {
  const players = playersRaw as Board<PlayerRow> | null;
  const picks = picksRaw as Board<PickRow> | null;
  const asOf = players?.valuesAsOf?.sf_dynasty;
  const time = Date.parse(asOf ?? "");
  if (!asOf || !Number.isFinite(time) || now.getTime() - time > 36 * 3600000 || time > now.getTime() + 300000 ||
      picks?.valuesAsOf?.sf_dynasty !== asOf || !Array.isArray(players?.players) || !Array.isArray(picks?.picks) ||
      players.total !== players.players.length || players.players.length < minimumPlayers || picks.total !== picks.picks.length || !picks.picks.length) return null;
  const priceByPlayer = new Map<string, number>();
  const seen = new Set<string>();
  for (const row of players.players) {
    if (typeof row.id !== "string" || !row.id || seen.has(row.id)) return null;
    seen.add(row.id);
    const value = row.value?.sf_dynasty;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) priceByPlayer.set(row.id, value);
  }
  const grouped = new Map<string, Map<string, number>>();
  for (const row of picks.picks) {
    const value = row.value?.sf_dynasty;
    if (!Number.isInteger(row.year) || !Number.isInteger(row.round) || !["early", "mid", "late"].includes(row.variant ?? "") || typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    const key = `${row.year}:${row.round}`;
    const variants = grouped.get(key) ?? new Map<string, number>();
    if (variants.has(row.variant!)) return null;
    variants.set(row.variant!, value); grouped.set(key, variants);
  }
  const priceByPick = new Map<string, number>();
  for (const [key, variants] of grouped) if (["early", "mid", "late"].every(x => variants.has(x))) {
    priceByPick.set(key, Math.round([...variants.values()].reduce((a, b) => a + b, 0) / 3));
  }
  return { asOf, players: priceByPlayer, picks: priceByPick };
}

/**
 * Use one provider for the entire current comparison. An unranked player is an
 * explicitly labeled zero estimate, never a claim of retirement or a quote.
 * Unknown pick prices and trades with no actual quoted asset are not graded.
 */
export function withStatsGuyCurrentFallback(trade: ReviewTrade, snapshot: Snapshot | null): ReviewTrade {
  if (!snapshot || trade.sides.every(side => currentOutcomeGrade(side)?.status !== "INCOMPLETE" && side.grades !== null)) return trade;
  let quoted = 0, missing = false;
  function pricePlayer(id: string | undefined) {
    if (!id) { missing = true; return { value: null, unranked: false }; }
    const value = snapshot!.players.get(id);
    if (value !== undefined) { quoted++; return { value, unranked: false }; }
    return { value: 0, unranked: true };
  }
  function convert(asset: ReviewAsset): ReviewAsset {
    if (asset.outcome) {
      const price = pricePlayer(asset.outcome.sleeperId);
      const retired = price.unranked && asset.outcome.currentValueIsRetired === true;
      return { ...asset, currentValue: null, currentObservedAt: snapshot!.asOf, outcome: { ...asset.outcome, currentValue: price.value, currentValueIsUnranked: price.unranked && !retired, currentValueIsRetired: retired, retiredSource: retired ? asset.outcome.retiredSource : undefined } };
    }
    if (asset.assetType === "player") {
      const price = pricePlayer(asset.sleeperId);
      const retired = price.unranked && asset.currentValueIsRetired === true;
      return { ...asset, currentValue: price.value, currentValueIsUnranked: price.unranked && !retired, currentValueIsRetired: retired, retiredSource: retired ? asset.retiredSource : undefined, currentObservedAt: snapshot!.asOf };
    }
    const match = /^pick:(\d{4}):(\d+):/.exec(asset.id);
    const value = match ? snapshot!.picks.get(`${match[1]}:${match[2]}`) : undefined;
    if (value === undefined) { missing = true; return asset; }
    quoted++;
    return { ...asset, currentValue: value, currentObservedAt: snapshot!.asOf };
  }
  const sides = trade.sides.map(side => {
    const got = side.got.map(convert), gave = side.gave.map(convert);
    return { ...side, got, gave, grades: calculateTradeSideGrades({ ...side, got, gave }) };
  });
  if (missing || !quoted || sides.some(side => currentOutcomeGrade(side)?.status === "INCOMPLETE")) return trade;
  return { ...trade, sides, currentValueSource: "STATSGUY" };
}

export async function fetchStatsGuyCurrentSnapshot(): Promise<Snapshot | null> {
  try {
    const options = { next: { revalidate: 3600 }, signal: AbortSignal.timeout(20000) };
    const [players, picks] = await Promise.all([
      fetch("https://api.statsguyfantasy.com/api/v1/players", options),
      fetch("https://api.statsguyfantasy.com/api/v1/picks", options),
    ]);
    if (!players.ok || !picks.ok) return null;
    return parseStatsGuySnapshot(await players.json(), await picks.json());
  } catch { return null; }
}
