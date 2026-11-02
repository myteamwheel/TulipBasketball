import assert from "node:assert/strict";
import test from "node:test";
import { calculateTradeSideGrades } from "./tradeGrades";
import { coverage, rankTrades, tradeWinner, type ReviewAsset, type ReviewFilters, type ReviewSide, type ReviewTrade } from "./tradeReview";

const filters: ReviewFilters = { team: null, season: "all", opponent: null, asset: "all", faab: "all" };
function asset(id: string, then: number | null, now: number | null, assetType: "player" | "pick" = "player"): ReviewAsset {
  return { id, playerId: assetType === "player" ? id : null, label: id, assetType, atTradeValue: then, currentValue: now, atMoveObservedAt: null, atMoveTiming: null };
}
function side(rosterId: number, name: string, gave: ReviewAsset[], got: ReviewAsset[], faabSent = 0, faabReceived = 0): ReviewSide {
  return { rosterId, name, gave, got, faabSent, faabReceived, grades: calculateTradeSideGrades({ gave, got, faabSent, faabReceived }) };
}
function trade(id: string, date: string, sides: ReviewSide[]): ReviewTrade { return { id, date, sides }; }

test("ranks the entire recorded set before a page is sliced", () => {
  const trades = Array.from({ length: 20 }, (_, index) => trade(String(index), "2025-10-01T12:00:00.000Z", [
    side(1, "Alpha", [asset("gave-" + index, 1000, 1000)], [asset("got-" + index, 1100 + index * 100, 1100 + index * 100)]),
    side(2, "Beta", [asset("got-" + index, 1100 + index * 100, 1100 + index * 100)], [asset("gave-" + index, 1000, 1000)]),
  ]));
  const ranked = rankTrades(trades, "winsNow", "points", filters);
  assert.equal(ranked.length, 20);
  assert.equal(ranked[0].trade.id, "19");
  assert.equal(ranked[0].side?.name, "Alpha");
  assert.equal(ranked.slice(15)[0].trade.id, "4");
});

test("historical and current eligibility stay independent", () => {
  const missingThen = trade("missing", "2025-10-01T12:00:00.000Z", [
    side(1, "Alpha", [asset("out", null, 1000)], [asset("in", null, 2000)]),
    side(2, "Beta", [asset("in", null, 2000)], [asset("out", null, 1000)]),
  ]);
  assert.deepEqual(coverage([missingThen]), { total: 1, atTrade: 0, current: 1, both: 0 });
  assert.equal(rankTrades([missingThen], "winsThen", "points", filters).length, 0);
  assert.equal(rankTrades([missingThen], "winsNow", "points", filters).length, 1);
  assert.equal(tradeWinner(missingThen, "atTrade"), "Unavailable");
  assert.equal(tradeWinner(missingThen, "current"), "Alpha");
});

test("recorded FAAB is excluded from a grade while player-for-FAAB remains rankable", () => {
  const deal = trade("cash", "2025-10-01T12:00:00.000Z", [
    side(1, "Alpha", [], [asset("player", 1200, 1400)], 25),
    side(2, "Beta", [asset("player", 1200, 1400)], [], 0, 25),
  ]);
  assert.equal(deal.sides[0].grades?.atTrade.balance?.adjustedEdge, 1200);
  assert.equal(deal.sides[1].grades?.atTrade.status, "READY");
  assert.equal(rankTrades([deal], "winsThen", "points", filters).length, 1);
  assert.equal(rankTrades([deal], "winsNow", "points", { ...filters, faab: "yes" }).length, 1);
  const cashOnly = trade("cashonly", deal.date, [side(1, "Alpha", [], [], 25), side(2, "Beta", [], [], 0, 25)]);
  assert.equal(rankTrades([cashOnly], "winsNow", "points", filters).length, 0);
});

test("filters team, opponent, season, asset and FAAB without changing source history", () => {
  const deal = trade("pick", "2024-10-01T12:00:00.000Z", [
    side(1, "Alpha", [asset("out", 1000, 1000)], [asset("pick", 2000, 2000, "pick")]),
    side(2, "Beta", [asset("pick", 2000, 2000, "pick")], [asset("out", 1000, 1000)]),
  ]);
  const matching = { ...filters, team: 1, opponent: 2, season: "2024", asset: "pick" as const, faab: "no" as const };
  assert.equal(rankTrades([deal], "winsNow", "points", matching).length, 1);
  assert.equal(rankTrades([deal], "winsNow", "points", { ...matching, opponent: 3 }).length, 0);
  assert.equal(rankTrades([deal], "winsNow", "points", { ...matching, season: "2025" }).length, 0);
  assert.equal(rankTrades([deal], "winsNow", "points", { ...matching, faab: "yes" }).length, 0);
});

test("reversal requires a negative then edge and positive current edge", () => {
  const deal = trade("flip", "2025-10-01T12:00:00.000Z", [
    side(1, "Alpha", [asset("out", 2000, 1000)], [asset("in", 1000, 3000)]),
    side(2, "Beta", [asset("in", 1000, 3000)], [asset("out", 2000, 1000)]),
  ]);
  const ranked = rankTrades([deal], "reversals", "points", filters);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].side?.name, "Alpha");
  assert.equal(ranked[0].score, 3000);
});
