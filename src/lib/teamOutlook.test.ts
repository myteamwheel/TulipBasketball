import assert from "node:assert/strict";
import test from "node:test";
import { assessPositionOutlook, strategySummary } from "./teamOutlook";

test("rebuilding teams prioritize weak QB/WR groups as core needs", () => {
  const result = assessPositionOutlook({
    position: "QB",
    activePlayers: 1,
    targetDepth: 3,
    starterCapitalRank: 10,
    teamCount: 12,
    window: "REBUILDER",
  });
  assert.equal(result.status, "NEED");
  assert.equal(result.priority, "Core need");
  assert.match(result.explanation, /1 start-eligible vs 3/);
  assert.match(strategySummary("REBUILDER"), /future picks/);
});

test("contenders are told when a position is a win-now need", () => {
  const result = assessPositionOutlook({
    position: "WR",
    activePlayers: 5,
    targetDepth: 5,
    starterCapitalRank: 11,
    teamCount: 12,
    window: "CONTENDER",
  });
  assert.equal(result.status, "NEED");
  assert.equal(result.priority, "Win-now need");
  assert.match(strategySummary("CONTENDER"), /Compete now/);
});

test("a top-third deep position is only called surplus when depth exceeds target", () => {
  const result = assessPositionOutlook({
    position: "RB",
    activePlayers: 5,
    targetDepth: 4,
    starterCapitalRank: 3,
    teamCount: 12,
    window: "REBUILDER",
  });
  assert.equal(result.status, "SURPLUS");
  assert.equal(result.priority, "Review for trade value");
});

test("middle teams are not labeled surplus or need without evidence", () => {
  const result = assessPositionOutlook({
    position: "TE",
    activePlayers: 3,
    targetDepth: 3,
    starterCapitalRank: 6,
    teamCount: 12,
    window: "MIDDLE",
  });
  assert.equal(result.status, "BALANCED");
  assert.equal(result.priority, "No clear gap");
});

test("missing market values remain unknown instead of being treated as zero", () => {
  const result = assessPositionOutlook({
    position: "WR",
    activePlayers: 5,
    targetDepth: 5,
    starterCapitalRank: null,
    teamCount: 12,
    window: "MIDDLE",
  });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.priority, "Market data incomplete");
  assert.match(result.explanation, /not enough fresh starter values/);
});

test("a known roster-depth shortage stays a need if market values are missing", () => {
  const result = assessPositionOutlook({
    position: "QB",
    activePlayers: 1,
    targetDepth: 3,
    starterCapitalRank: null,
    teamCount: 12,
    window: "MIDDLE",
  });
  assert.equal(result.status, "NEED");
  assert.match(result.explanation, /1 start-eligible vs 3/);
  assert.match(result.explanation, /values are incomplete/);
});
