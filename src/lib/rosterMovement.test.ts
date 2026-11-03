import test from "node:test";
import assert from "node:assert/strict";
import { rosterMovement } from "./rosterMovement";

test("roster movement nets known additions and departures without changing unrelated teams", () => {
  const totals = rosterMovement([
    { managerId: "buyer", direction: 1, value: 5000, stale: false },
    { managerId: "buyer", direction: -1, value: 3000, stale: false },
    { managerId: "seller", direction: -1, value: 5000, stale: false },
    { managerId: "seller", direction: 1, value: 3000, stale: false },
  ]);
  assert.equal(totals.get("buyer"), 2000);
  assert.equal(totals.get("seller"), -2000);
  assert.equal(totals.has("uninvolved"), false);
});

test("unpriced or stale movements withhold the entire affected total in either order", () => {
  for (const bad of [{ value: null, stale: false }, { value: 4000, stale: true }, { value: NaN, stale: false }, { value: 0, stale: false }]) {
    const unknown = { managerId: "team", direction: -1 as const, ...bad };
    const known = { managerId: "team", direction: 1 as const, value: 5000, stale: false };
    assert.equal(rosterMovement([unknown, known]).get("team"), null);
    assert.equal(rosterMovement([known, unknown]).get("team"), null);
  }
});

test("equal fully priced additions and departures remain a genuine zero", () => {
  assert.equal(rosterMovement([
    { managerId: "team", direction: 1, value: 3000, stale: false },
    { managerId: "team", direction: -1, value: 3000, stale: false },
  ]).get("team"), 0);
});
