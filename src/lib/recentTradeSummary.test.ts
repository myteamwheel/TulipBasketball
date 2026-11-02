import test from "node:test";
import assert from "node:assert/strict";
import { summarizeRecentTrade } from "./recentTradeSummary";

test("home trade summary names both teams and their received assets, including FAAB", () => {
  const result = summarizeRecentTrade({
    rosterIdsInvolved: "[1,2]",
    adds: '{"p1":1}',
    draftPicks: "[]",
    waiverBudget: '[{"sender":1,"receiver":2,"amount":85}]',
  }, new Map([[1, "Flowers"], [2, "Missle"]]), { p1: "Daniel Jones" });
  assert.equal(result.title, "Flowers ↔ Missle");
  assert.deepEqual(result.packages, [
    { team: "Flowers", assets: ["Daniel Jones"] },
    { team: "Missle", assets: ["$85 FAAB"] },
  ]);
});

test("unreadable trade fields do not invent received players or picks", () => {
  const result = summarizeRecentTrade({ rosterIdsInvolved: "[1,2]", adds: "bad", draftPicks: "bad", waiverBudget: "bad" }, new Map(), {});
  assert.deepEqual(result.packages.map(row => row.assets), [[], []]);
});
