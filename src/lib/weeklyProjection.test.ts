import test from "node:test";
import assert from "node:assert/strict";
import { halfPprPoints, type ProjectedStatLine } from "@/lib/weeklyProjection";

const empty = (): ProjectedStatLine => ({
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
});

test("halfPprPoints scores a passing line correctly", () => {
  const stats = empty();
  stats.passingYards = 300;
  stats.passingTds = 2;
  stats.interceptions = 1;
  stats.rushingYards = 20;
  assert.equal(halfPprPoints(stats), 20);
});

test("halfPprPoints scores receiving and rushing correctly", () => {
  const stats = empty();
  stats.carries = 15;
  stats.rushingYards = 80;
  stats.rushingTds = 1;
  stats.targets = 6;
  stats.receptions = 5;
  stats.receivingYards = 40;
  stats.receivingTds = 1;
  assert.equal(halfPprPoints(stats), 26.5);
});
