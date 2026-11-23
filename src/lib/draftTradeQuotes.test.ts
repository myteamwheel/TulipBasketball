import { test } from "node:test";
import assert from "node:assert/strict";
import { recentDraftTradeQuotes } from "./draftTradeQuotes";

test("trade fallback uses recent, positive, identity-matched KTC quotes only", () => {
  const profile = "https://keeptradecut.com/dynasty-rankings/players/example-123";
  const rows = [
    { playerId: "1", profile, now: { date: "2026-11-22", value: 450 } },
    { playerId: "2", profile, now: { date: "2026-11-19", value: 400 } },
    { playerId: "3", profile, now: { date: "2026-11-23", value: 300 } },
    { playerId: "4", profile, now: { date: "2026-11-22", value: 0 } },
    { playerId: "5", profile: null, now: { date: "2026-11-22", value: 200 } },
  ];
  const quotes = recentDraftTradeQuotes(rows, new Date("2026-11-22T20:00:00Z"));
  assert.deepEqual([...quotes], [["1", { date: "2026-11-22", value: 450 }]]);
});
