import assert from "node:assert/strict";
import test from "node:test";
import { scoreFantasyLine, type ProjectedStatLine } from "@/lib/playerProjections";

function line(overrides: Partial<ProjectedStatLine> = {}): ProjectedStatLine {
  return {
    completions: 0,
    attempts: 0,
    passingYards: 0,
    passingTds: 0,
    interceptions: 0,
    carries: 0,
    rushingYards: 0,
    rushingTds: 0,
    targets: 0,
    receptions: 0,
    receivingYards: 0,
    receivingTds: 0,
    fumblesLost: 0,
    ...overrides,
  };
}

test("scoreFantasyLine defaults to half-PPR football scoring", () => {
  const value = scoreFantasyLine(
    line({
      passingYards: 250,
      passingTds: 2,
      interceptions: 1,
      rushingYards: 20,
      receptions: 4,
      receivingYards: 40,
      receivingTds: 1,
      fumblesLost: 1,
    }),
  );
  assert.equal(value, 28);
});

test("scoreFantasyLine honors Sleeper scoring settings for modeled stats", () => {
  const value = scoreFantasyLine(
    line({ passingYards: 100, passingTds: 1, receptions: 2 }),
    { pass_yd: 0.05, pass_td: 6, rec: 1 },
  );
  assert.equal(value, 13);
});
