import assert from "node:assert/strict";
import test from "node:test";
import { faabForRoster, parseFaabTransfers } from "./tradeFaab";

test("recorded FAAB is attributed only to its sender and receiver", () => {
  // Real Sleeper player-for-FAAB ledger shape, also used for historical rows.
  const transfers = parseFaabTransfers('[{"amount":9,"sender":7,"receiver":3},{"amount":"5","sender":"7","receiver":"10"}]');
  assert.deepEqual(faabForRoster(transfers, 7), { faabSent: 14, faabReceived: 0 });
  assert.deepEqual(faabForRoster(transfers, 3), { faabSent: 0, faabReceived: 9 });
  assert.deepEqual(faabForRoster(transfers, 11), { faabSent: 0, faabReceived: 0 });
});

test("invalid FAAB cannot turn missing ledger data into a rated trade", () => {
  for (const raw of [null, "invalid", "{}", "[null]", '[{"sender":1,"receiver":2}]']) {
    assert.deepEqual(parseFaabTransfers(raw), []);
  }
  for (const amount of [0, -1, "", null, true, "Infinity"]) {
    assert.deepEqual(parseFaabTransfers(JSON.stringify([{ amount, sender: 1, receiver: 2 }])), []);
  }
  for (const sender of [0, -1, null, 1.5, true, 2]) {
    assert.deepEqual(parseFaabTransfers(JSON.stringify([{ amount: 9, sender, receiver: 2 }])), []);
  }
});
