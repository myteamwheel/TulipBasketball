import test from "node:test";
import assert from "node:assert/strict";
import { parseNflSchedule } from "./nflSchedule";

test("kickoff uses Eastern daylight and standard time; empty scores are not completed games", () => {
  const games = parseNflSchedule("season,game_type,week,gameday,gametime,home_team,away_team,home_score,away_score\n2026,REG,3,2026-09-24,20:15,NYG,DAL,,\n2026,REG,12,2026-11-29,13:00,BUF,NE,0,10\n");
  assert.equal(new Date(games[0].kickoff).toISOString(), "2026-09-25T00:15:00.000Z");
  assert.equal(games[0].completed, false);
  assert.equal(new Date(games[1].kickoff).toISOString(), "2026-11-29T18:00:00.000Z");
  assert.equal(games[1].completed, true);
});
