import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectedStatLine } from "./weeklyProjection";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/postgres";
process.env.RECOVERY_DATABASE_URL ??= "postgresql://user:pass@localhost:5432/postgres";

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

test("halfPprPoints scores a passing line correctly", async () => {
  const { halfPprPoints } = await import("./weeklyProjection");
  const stats = empty();
  stats.passingYards = 300;
  stats.passingTds = 2;
  stats.interceptions = 1;
  stats.rushingYards = 20;
  assert.equal(halfPprPoints(stats), 20);
});

test("halfPprPoints scores receiving and rushing correctly", async () => {
  const { halfPprPoints } = await import("./weeklyProjection");
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


test("discreteStatLine never emits fractional football events", async () => {
  const { discreteStatLine } = await import("./weeklyProjection");
  const stats = empty();
  stats.completions = 17.1;
  stats.attempts = 25.8;
  stats.passingYards = 163.4;
  stats.passingTds = 0.74;
  stats.interceptions = 0.49;
  stats.targets = 7.6;
  stats.receptions = 4.2;
  stats.receivingYards = 68.7;
  stats.receivingTds = 0.34;
  const line = discreteStatLine(stats);
  for (const value of Object.values(line)) assert.equal(Number.isInteger(value), true);
  assert.equal(line.completions <= line.attempts, true);
  assert.equal(line.receptions <= line.targets, true);
});

test("externalRoleSupported rejects tiny contingency backup projections", async () => {
  const { externalRoleSupported } = await import("./weeklyProjection");
  const make = (
    position: string,
    fantasyPointsHalfPpr: number,
    overrides: Partial<ProjectedStatLine>,
  ) => ({
    source: "CBS" as const,
    sleeperId: "test",
    playerName: "Test Player",
    position,
    nflTeam: "TST",
    fantasyPointsHalfPpr,
    stats: { ...empty(), ...overrides },
    fetchedAt: new Date(0).toISOString(),
  });

  assert.equal(
    externalRoleSupported("QB", [make("QB", 1, { attempts: 1.5 })]),
    false,
  );
  assert.equal(
    externalRoleSupported("QB", [make("QB", 15, { attempts: 27 })]),
    true,
  );
  assert.equal(
    externalRoleSupported("RB", [make("RB", 1, { carries: 1, targets: 0 })]),
    false,
  );
  assert.equal(
    externalRoleSupported("WR", [make("WR", 1.5, { targets: 1 })]),
    false,
  );
  assert.equal(
    externalRoleSupported("TE", [make("TE", 4, { targets: 3 })]),
    true,
  );
});
