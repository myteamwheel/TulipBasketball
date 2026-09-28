import assert from "node:assert/strict";
import test from "node:test";
import { calculateTradeSideGrades } from "./tradeGrades";

const asset = (
  id: string,
  atTradeValue: number | null,
  currentValue: number | null,
) => ({ id, label: id, assetType: "player" as const, atTradeValue, currentValue });

test("grades an even-at-trade deal differently after fresh values move", () => {
  const grades = calculateTradeSideGrades({
    gave: [asset("Veteran", 5_000, 2_500)],
    got: [asset("Young player", 5_050, 6_500)],
  });

  assert.equal(grades.atTrade.status, "READY");
  assert.equal(grades.atTrade.grade, "B");
  assert.equal(grades.atTrade.result, "EVEN");
  assert.equal(grades.current.status, "READY");
  assert.equal(grades.current.grade, "A+");
  assert.equal(grades.current.result, "WON");
});

test("withholds a historical grade when any trade asset lacks a nearby snapshot", () => {
  const grades = calculateTradeSideGrades({
    gave: [asset("Known player", 3_000, 3_200)],
    got: [asset("Unknown historical player", null, 3_100)],
  });

  assert.equal(grades.atTrade.status, "INCOMPLETE");
  assert.equal(grades.atTrade.grade, null);
  assert.match(grades.atTrade.reason ?? "", /No verified KTC/);
  assert.deepEqual(grades.atTrade.missingAssets, ["Unknown historical player"]);
  assert.equal(grades.current.status, "READY");
});

test("withholds both grades when a trade includes unpriced FAAB", () => {
  const grades = calculateTradeSideGrades({
    gave: [asset("Player A", 3_000, 3_000)],
    got: [asset("Player B", 3_200, 3_200)],
    hasUnpricedAssets: true,
  });

  assert.equal(grades.atTrade.status, "INCOMPLETE");
  assert.equal(grades.current.status, "INCOMPLETE");
  assert.match(grades.current.reason ?? "", /FAAB/);
});

test("grades use the same package adjustment as the trade calculator", () => {
  const grades = calculateTradeSideGrades({
    gave: [asset("Star", 7_000, 7_000)],
    got: [asset("Depth A", 3_600, 3_600), asset("Depth B", 3_600, 3_600)],
  });

  assert.equal(grades.current.status, "READY");
  assert.equal(grades.current.result, "LOST");
  assert.equal(grades.current.grade, "B-");
});
