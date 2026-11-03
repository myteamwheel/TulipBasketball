import test from "node:test";
import assert from "node:assert/strict";
import { pendingProjectionPlayers } from "./projectionCoverage";

const players = ["active", "excluded", "completed", "old-week", "missing"].map(id => ({ id, fullName: id, position: "WR", nflTeam: "NYJ" }));
test("new-week and missing-refresh players remain visible, without replacing forecasts or final results", () => {
  const pending = pendingProjectionPlayers(players, [{ playerId: "active" }], [{ playerId: "excluded" }], [
    { playerId: "completed", season: 2026, week: 9, actualFantasyPoints: 0 },
    { playerId: "old-week", season: 2026, week: 8, actualFantasyPoints: 12 },
  ], 2026, 9);
  assert.deepEqual(pending.map(row => row.id), ["old-week", "missing"]);
});
test("a week rollover keeps every player pending until current-week evidence arrives", () => {
  assert.equal(pendingProjectionPlayers(players, [], [], [], 2026, 10).length, players.length);
});
