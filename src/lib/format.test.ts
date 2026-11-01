import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPercent,
  formatPoints,
  formatProbability,
  formatSigned,
  formatDateEastern,
  formatDateTimeEastern,
  timeAgo,
  trendColorClass,
} from "@/lib/format";

test("formatProbability does not round real chances to zero or one hundred", () => {
  assert.equal(formatProbability(0), "0%");
  assert.equal(formatProbability(0.004), "<1%");
  assert.equal(formatProbability(0.044), "4%");
  assert.equal(formatProbability(0.996), ">99%");
  assert.equal(formatProbability(1), "100%");
});

test("malformed values never print NaN/Infinity or crash a date display", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    for (const format of [formatPoints, formatSigned, formatPercent, formatProbability]) assert.equal(format(invalid), "—");
    assert.equal(trendColorClass(invalid), "text-neutral-400");
  }
  assert.equal(formatDateEastern("invalid"), "—");
  assert.equal(formatDateTimeEastern("invalid"), "—");
  assert.equal(timeAgo("invalid"), "unknown");
  assert.equal(formatSigned(-0.1), "±0");
  assert.equal(formatPoints(-0.1), "0");
  assert.equal(formatPercent(0.001), "0.0%");
});

test("future timestamps are not described as freshly observed", t => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-01T18:00:00Z"));
  assert.equal(timeAgo("2026-11-01T19:00:00Z"), "in 1h");
  assert.equal(timeAgo("2026-11-01T17:00:00Z"), "1h ago");
});

test("market formatters preserve missing, signed, and rounded values", () => {
  assert.equal(formatPoints(null), "—");
  assert.equal(formatPoints(1234.6), "1,235");
  assert.equal(formatSigned(0), "±0");
  assert.equal(formatSigned(-12.6), "-13");
  assert.equal(formatPercent(3.14159), "+3.1%");
});
