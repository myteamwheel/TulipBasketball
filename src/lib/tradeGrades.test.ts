import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateTradeSideGrades,
  selectTradeSnapshot,
} from "./tradeGrades";

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

type Snapshot = {
  id: string;
  observedAt: Date;
  valid: boolean;
};

const date = (iso: string) => new Date(iso);
const snapshots = (...items: Array<[string, string, boolean]>): Snapshot[] =>
  items.map(([id, observedAt, valid]) => ({ id, observedAt: date(observedAt), valid }));

test("historical trade snapshots prefer the latest verified pre-trade observation", () => {
  const tradeAt = date("2026-09-27T18:00:00.000Z");
  const selection = selectTradeSnapshot(
    snapshots(
      ["old", "2026-09-26T17:59:59.000Z", true],
      ["best", "2026-09-27T17:45:00.000Z", true],
      ["later", "2026-09-27T18:05:00.000Z", true],
      ["unverified", "2026-09-27T17:55:00.000Z", false],
    ),
    tradeAt,
    (snapshot) => snapshot.valid,
  );

  assert.equal(selection?.snapshot.id, "best");
  assert.equal(selection?.timing, "AT_OR_BEFORE");
});

test("uses only the first verified next-day snapshot as an explicitly labeled approximation", () => {
  const tradeAt = date("2026-09-27T18:00:00.000Z");
  const selection = selectTradeSnapshot(
    snapshots(
      ["too-old", "2026-09-26T17:59:59.000Z", true],
      ["first-after", "2026-09-27T20:00:00.000Z", true],
      ["later-after", "2026-09-28T10:00:00.000Z", true],
    ),
    tradeAt,
    (snapshot) => snapshot.valid,
  );

  assert.equal(selection?.snapshot.id, "first-after");
  assert.equal(selection?.timing, "NEXT_DAY_APPROXIMATION");
});

test("later refreshes cannot displace a selected trade snapshot and out-of-window rows are withheld", () => {
  const tradeAt = date("2026-09-27T18:00:00.000Z");
  const before = snapshots(["pre-trade", "2026-09-27T17:00:00.000Z", true]);
  const withFutureRefreshes = [
    ...before,
    ...snapshots(
      ["late-refresh", "2026-09-27T22:00:00.000Z", true],
      ["next-run", "2026-09-28T17:00:00.000Z", true],
    ),
  ];

  assert.equal(
    selectTradeSnapshot(before, tradeAt, (snapshot) => snapshot.valid)?.snapshot.id,
    "pre-trade",
  );
  assert.equal(
    selectTradeSnapshot(withFutureRefreshes, tradeAt, (snapshot) => snapshot.valid)?.snapshot.id,
    "pre-trade",
  );
  assert.equal(
    selectTradeSnapshot(
      snapshots(["too-late", "2026-09-28T18:00:01.000Z", true]),
      tradeAt,
      (snapshot) => snapshot.valid,
    ),
    null,
  );
});
