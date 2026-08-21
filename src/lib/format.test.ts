import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPercent,
  formatPoints,
  formatProbability,
  formatSigned,
} from "@/lib/format";

test("formatProbability does not round real chances to zero or one hundred", () => {
  assert.equal(formatProbability(0), "0%");
  assert.equal(formatProbability(0.004), "<1%");
  assert.equal(formatProbability(0.044), "4%");
  assert.equal(formatProbability(0.996), ">99%");
  assert.equal(formatProbability(1), "100%");
});

test("market formatters preserve missing, signed, and rounded values", () => {
  assert.equal(formatPoints(null), "—");
  assert.equal(formatPoints(1234.6), "1,235");
  assert.equal(formatSigned(0), "±0");
  assert.equal(formatSigned(-12.6), "-13");
  assert.equal(formatPercent(3.14159), "+3.1%");
});
