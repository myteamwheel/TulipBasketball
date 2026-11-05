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

test("balance sorts rank absolute gaps independently by period, including exact ties", () => {
  function exchange(id: string, sent: ReviewAsset, received: ReviewAsset) {
    return trade(id, "2025-10-01T12:00:00.000Z", [
      side(1, "Alpha", [sent], [received]),
      side(2, "Beta", [received], [sent]),
    ]);
  }
  const evenThen = exchange("even-then", asset("a", 1000, 3000), asset("b", 1000, 1000));
  const evenNow = exchange("even-now", asset("c", 3000, 1000), asset("d", 1000, 1000));
  const missingThen = exchange("missing-then", asset("e", null, 1500), asset("f", 1200, 1000));
  const deals = [evenThen, evenNow, missingThen];
  const ids = (sort: Parameters<typeof rankTrades>[1]) => rankTrades(deals, sort, "points", { ...filters, team: 1 }).map(row => row.trade.id);
  assert.deepEqual(ids("unequalThen"), ["even-now", "even-then"]);
  assert.deepEqual(ids("equalThen"), ["even-then", "even-now"]);
  assert.deepEqual(ids("unequalNow"), ["even-then", "missing-then", "even-now"]);
  assert.deepEqual(ids("equalNow"), ["even-now", "missing-then", "even-then"]);
});

test("current balance ranks a used pick by its drafted player, with missing outcomes excluded", () => {
  const pick = asset("pick", 2300, null, "pick");
  pick.outcome = { label: "Drafted player", playerId: "drafted", sleeperId: "1", pickNumber: 6, currentValue: 2000, sourceUrl: "https://sleeper.com" };
  const player = asset("player", 1800, 2000);
  const deal = trade("used-pick", "2025-10-01T12:00:00.000Z", [side(1, "Alpha", [player], [pick]), side(2, "Beta", [pick], [player])]);
  assert.equal(rankTrades([deal], "equalNow", "percent", filters)[0]?.score, 0);
  assert.equal(rankTrades([deal], "winsNow", "percent", filters).length, 0);
  pick.outcome.currentValue = null;
  assert.equal(rankTrades([deal], "unequalNow", "percent", filters).length, 0);
});

test("on-field contribution excludes a trade-week start and stops at roster departure", async () => {
  const { tradeOnField } = await import('./tradeOnField');
  const team = (week: number, hasPlayer: boolean, starts: boolean) => ({ season: '2023', leagueId: 'league', week, start: week * 1000, rows: [
    {roster_id: 1, matchup_id: 1, points: 110, custom_points: null, players: hasPlayer ? ['p'] : [], starters: starts ? ['p'] : [], starters_points: starts ? [12] : []},
    {roster_id: 2, matchup_id: 1, points: 100, custom_points: null, players: [], starters: [], starters_points: []},
  ] });
  const weeks = [team(1,true,true),team(2,true,true),team(3,false,false),team(4,true,true)];
  assert.deepEqual(tradeOnField(weeks,'league',1000,1,['p']), {starts:1,points:12,wins:1,losses:0,ties:0,firstWeek:2,lastWeek:2});
});

test("verified retirement permits an assumed zero current value without treating unknown prices as zero", () => {
  const retired = { ...asset("Retired", 4000, 0), currentValueIsRetired: true };
  const active = asset("Active", 2000, 1500);
  const rated = side(1, "Team", [retired], [active]);
  assert.equal(rated.grades?.current.status, "READY");
  assert.equal(rated.grades?.current.balance?.adjustedEdge, 1500);
  const unverified = side(1, "Team", [{ ...retired, currentValueIsRetired: false }], [active]);
  assert.equal(unverified.grades?.current.status, "INCOMPLETE");
});
