import assert from "node:assert/strict";
import test from "node:test";
import { computePlayerMarketData, type Obs } from "./marketMetrics";

const now = new Date("2026-11-01T18:00:00Z");
const observation = (value: number, at: string, validationStatus = "VALID"): Obs => ({ value, observedAt: new Date(at), validationStatus, validationNote: null });

test("future, invalid and nonpositive observations cannot become fresh current prices", () => {
  const result = computePlayerMarketData(now, [
    observation(3000, "2026-11-01T17:00:00Z"),
    observation(9999, "2026-11-02T18:00:00Z"),
    observation(9000, "invalid"),
    observation(NaN, "2026-11-01T17:30:00Z"),
    observation(Infinity, "2026-11-01T17:40:00Z"),
    observation(0, "2026-11-01T17:50:00Z"),
    observation(-1, "2026-11-01T17:55:00Z"),
  ]);
  assert.equal(result.currentValue, 3000);
  assert.equal(result.currentObservedAt, "2026-11-01T17:00:00.000Z");
  assert.equal(result.isStale, false);
  assert.equal(result.rawObservationCount, 1);
  assert.deepEqual(result.sparkline, [{ value: 3000, observedAt: "2026-11-01T17:00:00.000Z" }]);
});

test("a future price cannot refresh an expired price or create a historical trend", () => {
  const result = computePlayerMarketData(now, [observation(2000, "2026-10-01T18:00:00Z"), observation(5000, "2026-11-02T18:00:00Z")]);
  assert.equal(result.isStale, true);
  assert.equal(result.currentValue, 2000);
  assert.equal(result.change7d, null);
  assert.equal(result.changeSinceLastRefresh, null);
  assert.equal(computePlayerMarketData(now, [observation(5000, "2026-11-02T18:00:00Z")]).currentValue, null);
});

test("valid history still calculates changes while a flagged price stays separate", () => {
  const result = computePlayerMarketData(now, [
    observation(1000, "2026-10-25T17:00:00Z"),
    observation(1100, "2026-10-31T17:00:00Z"),
    observation(1200, "2026-11-01T17:00:00Z"),
    observation(8000, "2026-11-01T17:30:00Z", "FLAGGED"),
  ]);
  assert.equal(result.currentValue, 1200);
  assert.equal(result.change7d?.points, 200);
  assert.equal(result.changeSinceLastRefresh?.points, 100);
  assert.equal(result.pendingReview, true);
  assert.equal(result.pendingReviewValue, 8000);
});
