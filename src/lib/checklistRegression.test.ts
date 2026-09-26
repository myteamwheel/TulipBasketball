import test from "node:test";
import assert from "node:assert/strict";
import { projectionSummary } from "./projectionSummary";
import { refreshDiagnostics } from "./refreshDiagnostics";
import { irEligible, taxiDeadlineLabel } from "./rosterChecks";

test("locked projections and withheld counts are disjoint", () => {
  const value = projectionSummary([{ playerId: "played" }, { playerId: "upcoming" }], [{ playerId: "played" }, { playerId: "out" }], []);
  assert.equal(value.withheld, 1);
  assert.equal(value.mae, null);
});
test("accuracy uses magnitude, direction and a fixed five-point threshold", () => {
  const summary = projectionSummary([], [], [{ absoluteError: 16.9, signedError: -16.9 }, { absoluteError: 5.1, signedError: 5.1 }, { absoluteError: 5, signedError: 5 }, { absoluteError: null, signedError: null }]);
  assert.equal(summary.mae, 9);
  assert.ok(Math.abs(summary.bias! + 6.8 / 3) < .0001);
  assert.ok(Math.abs(summary.withinFive! - 100 / 3) < .0001);
});
test("failed sources are named and routine exclusion notes are omitted", () => {
  const errors = refreshDiagnostics([{ source: "fantasycalc", message: "Excluded from consensus" }], [{ source: "STATSGUY", enabled: true, ok: false, message: "Feed unavailable" }], "PARTIAL_FAILURE");
  assert.deepEqual(errors, [{ source: "STATSGUY", message: "Feed unavailable" }]);
  assert.match(refreshDiagnostics([], [], "PARTIAL_FAILURE")[0].message, /No specific failing source/);
});
test("IR checks honor league eligibility flags", () => {
  assert.equal(irEligible("Out", { reserve_allow_out: 1 }), true);
  assert.equal(irEligible("Out", { reserve_allow_out: 0 }), false);
  assert.equal(irEligible("IR", {}), true);
  assert.equal(irEligible("Suspended", { reserve_allow_sus: 1 }), true);
  assert.equal(irEligible("Active", {}), false);
  assert.equal(irEligible(null, {}), null);
  assert.equal(taxiDeadlineLabel(4, true).locked, true);
  assert.equal(taxiDeadlineLabel(0, true).locked, false);
});
