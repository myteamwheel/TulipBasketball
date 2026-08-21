import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerMarketData } from "@/lib/metrics";
import { computeSignal, type RosterContext } from "@/lib/signals";

const context: RosterContext = {
  slot: "STARTER",
  position: "QB",
  status: "Active",
  positionRank: 6,
  leagueTeamCount: 12,
};

function market(overrides: Partial<PlayerMarketData> = {}): PlayerMarketData {
  const now = new Date("2026-08-20T12:00:00.000Z");
  return {
    playerId: "player-1",
    currentValue: 4000,
    currentObservedAt: now.toISOString(),
    dataAgeMs: 0,
    isStale: false,
    pendingReview: false,
    pendingReviewValue: null,
    pendingReviewNote: null,
    changeSinceLastRefresh: null,
    change7d: null,
    change30d: null,
    changeSinceBaseline: null,
    high: null,
    low: null,
    distanceFromHigh: null,
    distanceFromLow: null,
    observationCount: 1,
    rawObservationCount: 1,
    sparkline: [{ value: 4000, observedAt: now.toISOString() }],
    ...overrides,
  };
}

test("missing comparison windows remain WATCH instead of inventing momentum", () => {
  const result = computeSignal(market(), context);
  assert.equal(result.signal, "WATCH");
  assert.equal(result.confidence, "LOW");
  assert.ok(result.reasonCodes.some((reason) => reason.code === "WINDOW_GAP"));
});

test("a valid, stable history can produce a decision-grade HOLD", () => {
  const result = computeSignal(
    market({
      change7d: {
        points: 40,
        percent: 1,
        fromValue: 3960,
        fromObservedAt: "2026-08-13T12:00:00.000Z",
      },
      change30d: {
        points: 100,
        percent: 2.56,
        fromValue: 3900,
        fromObservedAt: "2026-07-21T12:00:00.000Z",
      },
      observationCount: 6,
      rawObservationCount: 6,
      sparkline: [
        { value: 3900, observedAt: "2026-08-10T12:00:00.000Z" },
        { value: 3960, observedAt: "2026-08-13T12:00:00.000Z" },
        { value: 4000, observedAt: "2026-08-20T12:00:00.000Z" },
      ],
    }),
    context,
  );
  assert.equal(result.signal, "HOLD");
  assert.equal(result.confidence, "HIGH");
});
