import assert from "node:assert/strict";
import test from "node:test";
import { calculateTradeSideGrades } from "./tradeGrades";
import { currentOutcomeGrade, rankTrades, tradeWinner, type ReviewAsset, type ReviewSide, type ReviewTrade } from "./tradeReview";
import { parseStatsGuySnapshot, withStatsGuyCurrentFallback } from "./currentTradeValues";

const now = new Date("2026-11-04T16:00:00Z");
const players = { total: 2, valuesAsOf: { sf_dynasty: "2026-11-04T13:00:00Z" }, players: [
  { id: "1", value: { sf_dynasty: 4000 } }, { id: "2", value: { sf_dynasty: 2000 } },
] };
const picks = { total: 3, valuesAsOf: { sf_dynasty: "2026-11-04T13:00:00Z" }, picks: [
  { year: 2027, round: 1, variant: "early", value: { sf_dynasty: 2400 } },
  { year: 2027, round: 1, variant: "mid", value: { sf_dynasty: 1800 } },
  { year: 2027, round: 1, variant: "late", value: { sf_dynasty: 1200 } },
] };
function player(id: string, currentValue: number | null): ReviewAsset {
  return { id, sleeperId: id, playerId: id, label: `Player ${id}`, assetType: "player", atTradeValue: 1000, currentValue, atMoveObservedAt: null, atMoveTiming: null };
}
function side(name: string, got: ReviewAsset[], gave: ReviewAsset[]): ReviewSide {
  return { name, rosterId: name === "A" ? 1 : 2, got, gave, grades: calculateTradeSideGrades({ got, gave }) };
}
function trade(a: ReviewAsset[], b: ReviewAsset[]): ReviewTrade {
  return { id: "t", date: now.toISOString(), sides: [side("A", a, b), side("B", b, a)] };
}

test("rejects stale, partial, or mismatched provider boards", () => {
  assert.ok(parseStatsGuySnapshot(players, picks, now, 2));
  assert.equal(parseStatsGuySnapshot({ ...players, total: 3 }, picks, now, 2), null);
  assert.equal(parseStatsGuySnapshot({ ...players, players: [players.players[0], { id: "2", value: {} }] }, picks, now, 2), null);
  assert.equal(parseStatsGuySnapshot(players, picks, new Date("2026-11-07"), 2), null);
  assert.equal(parseStatsGuySnapshot(players, { ...picks, valuesAsOf: { sf_dynasty: "2026-11-03T13:00:00Z" } }, now, 2), null);
});

test("fallback reprices the entire trade and labels an unlisted player as an estimate", () => {
  const board = parseStatsGuySnapshot(players, picks, now, 2)!;
  const result = withStatsGuyCurrentFallback(trade([player("1", 9000), player("3", null)], [player("2", 5000)]), board);
  assert.equal(result.currentValueSource, "STATSGUY");
  assert.equal(result.sides[0].got[0].currentValue, 4000);
  assert.equal(result.sides[0].got[1].currentValue, 0);
  assert.equal(result.sides[0].got[1].currentValueIsUnranked, true);
  assert.equal(result.sides[0].gave[0].currentValue, 2000);
  assert.equal(result.sides[0].grades?.current.status, "READY");
  assert.equal(result.sides[0].got[0].atTradeValue, 1000);
});

test("unlisted-only trades and missing identifiers do not receive a made-up grade", () => {
  const board = parseStatsGuySnapshot(players, picks, now, 2)!;
  const unlisted = trade([player("3", null)], [player("4", null)]);
  assert.equal(withStatsGuyCurrentFallback(unlisted, board), unlisted);
  const unidentified = { ...player("3", null), sleeperId: undefined };
  const missingId = trade([player("1", null)], [unidentified]);
  assert.equal(withStatsGuyCurrentFallback(missingId, board), missingId);
});

test("drafted player outcomes count estimated zero and are shown in current rankings", () => {
  const board = parseStatsGuySnapshot(players, picks, now, 2)!;
  const usedPick: ReviewAsset = { ...player("p", null), id: "pick:2025:1:1", assetType: "pick", sleeperId: undefined,
    outcome: { label: "Former player", playerId: null, sleeperId: "3", pickNumber: 1, currentValue: null, sourceUrl: "https://sleeper.com" } };
  const result = withStatsGuyCurrentFallback(trade([player("1", null)], [usedPick]), board);
  assert.equal(currentOutcomeGrade(result.sides[0])?.status, "READY");
  assert.equal(tradeWinner(result, "current"), "A");
  assert.equal(rankTrades([result], "winsNow", "percent", { team: null, season: "all", opponent: null, asset: "all", faab: "all" }).length, 1);
});

test("a complete KTC outcome keeps its original source", () => {
  const board = parseStatsGuySnapshot(players, picks, now, 2)!;
  const complete = trade([player("1", 9000)], [player("2", 5000)]);
  assert.equal(withStatsGuyCurrentFallback(complete, board), complete);
});

test("point changes do not subtract different providers' scales", () => {
  const board = parseStatsGuySnapshot(players, picks, now, 2)!;
  const mixed = withStatsGuyCurrentFallback(trade([player("1", null)], [player("2", null)]), board);
  const filters = { team: null, season: "all", opponent: null, asset: "all" as const, faab: "all" as const };
  assert.equal(rankTrades([mixed], "improved", "points", filters).length, 0);
  assert.equal(rankTrades([mixed], "improved", "percent", filters).length, 1);
});
