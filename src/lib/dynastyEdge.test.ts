import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDynastyEdge,
  decisionGradeConfidence,
  dynastyHorizonReliability,
} from "./dynastyEdge";

test("small samples are not labeled high confidence", () => {
  assert.equal(decisionGradeConfidence(3), "LOW");
  assert.equal(decisionGradeConfidence(8), "MEDIUM");
  assert.equal(decisionGradeConfidence(12), "HIGH");
});

test("aging production receives less dynasty weight", () => {
  const young = dynastyHorizonReliability("WR", 24, 16);
  const old = dynastyHorizonReliability("WR", 32, 16);
  assert.ok(young > old * 5);
});

test("an old productive player cannot create a thirty-percent edge alone", () => {
  const result = calculateDynastyEdge({
    position: "WR",
    age: 32,
    games: 16,
    currentValue: 1500,
    consensusValue: 1550,
    footballValue: 4000,
  });
  assert.ok(result.modelEdgePercent < 5);
});

test("fresh market agreement plus young football evidence can create an edge", () => {
  const result = calculateDynastyEdge({
    position: "WR",
    age: 24,
    games: 16,
    currentValue: 3000,
    consensusValue: 3300,
    footballValue: 4300,
  });
  assert.ok(result.modelEdgePercent > 10);
});
