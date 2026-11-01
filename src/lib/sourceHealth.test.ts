import assert from "node:assert/strict";
import test from "node:test";
import { sourceHealth } from "./sourceHealth";

test("a failed refresh remains visible even while its earlier snapshot is fresh", () => {
  const health = sourceHealth(false, 200, { enabled: true, ok: false, message: "Provider timed out" });
  assert.equal(health.tone, "warning");
  assert.match(health.label, /Refresh failed.*still fresh/);
  assert.equal(health.message, "Provider timed out");
});

test("freshness, coverage, configuration and failure states stay distinct", () => {
  assert.equal(sourceHealth(false, 200).label, "Fresh");
  assert.equal(sourceHealth(false, 0).label, "No player coverage");
  assert.equal(sourceHealth(true, 0).label, "Stale / unavailable");
  assert.equal(sourceHealth(true, 0, { enabled: true, ok: false }).label, "Refresh failed");
  assert.equal(sourceHealth(true, 0, { enabled: false, ok: false }).label, "Disabled");
});
