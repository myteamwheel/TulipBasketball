import assert from "node:assert/strict";
import test from "node:test";
import { materializeStoredSignalResults, type StoredSignalRow } from "@/lib/signalSnapshots";

const rows: StoredSignalRow[] = [
  { playerId: "p1", signal: "HOLD", score: 61, confidence: "MEDIUM", reasonCodes: '[{"code":"STABLE","label":"Stable","detail":"No action."}]' },
  { playerId: "p2", signal: "WATCH", score: 50, confidence: "LOW", reasonCodes: "[]" },
];

test("materializes a complete saved signal snapshot", () => {
  const result = materializeStoredSignalResults(["p1", "p2"], rows);
  assert.equal(result?.get("p1")?.signal, "HOLD");
  assert.equal(result?.get("p1")?.reasonCodes[0]?.detail, "No action.");
  assert.equal(result?.get("p2")?.confidence, "LOW");
});

test("rejects incomplete, duplicate, or malformed saved signal snapshots", () => {
  assert.equal(materializeStoredSignalResults(["p1", "p2"], rows.slice(0, 1)), null);
  assert.equal(materializeStoredSignalResults(["p1"], [rows[0], rows[0]]), null);
  assert.equal(
    materializeStoredSignalResults(["p1"], [{ ...rows[0], reasonCodes: "not-json" }]),
    null,
  );
  assert.equal(
    materializeStoredSignalResults(["p1"], [{ ...rows[0], score: 101 }]),
    null,
  );
});
