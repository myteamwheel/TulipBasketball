import assert from "node:assert/strict";
import test from "node:test";
import { getAllTransactions, validateSleeperRosterSnapshot, type SleeperLeague, type SleeperRoster, type SleeperUser } from "./sleeper";

test("one failed transaction week fails the sync instead of silently losing ledger coverage", async t => {
  t.mock.method(globalThis, "fetch", async (url: string) => url.endsWith("/2") ? new Response("unavailable", { status: 503 }) : Response.json([]));
  await assert.rejects(getAllTransactions("league", 3), /week 2 failed; the ledger was not refreshed/);
});

test("empty weeks are valid but a malformed transaction response is not", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "unavailable" }));
  await assert.rejects(getAllTransactions("league", 1), /not an array/);
});

test("full-week reads are uncached, bounded, and deduplicate repeated transactions", async t => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    requests.push(url);
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal);
    return Response.json(url.endsWith("/2") ? [] : [{ transaction_id: "trade", type: "trade", status: "complete" }]);
  });
  const rows = await getAllTransactions("league", 18);
  assert.equal(requests.length, 18);
  assert.equal(rows.length, 1);
  await assert.rejects(getAllTransactions("league", NaN), /Invalid/);
  await assert.rejects(getAllTransactions("league", 19), /Invalid/);
});

test("incomplete or conflicting roster snapshots cannot replace known ownership", () => {
  const league = { total_rosters: 2 } as SleeperLeague;
  const users = [{ user_id: "one" }, { user_id: "two" }] as SleeperUser[];
  const rosters = [{ roster_id: 1, players: ["a"] }, { roster_id: 2, players: ["b"] }] as SleeperRoster[];
  assert.doesNotThrow(() => validateSleeperRosterSnapshot(league, users, rosters));
  assert.throws(() => validateSleeperRosterSnapshot(league, users, rosters.slice(0, 1)), /incomplete/);
  assert.throws(() => validateSleeperRosterSnapshot(league, [], rosters), /incomplete/);
  assert.throws(() => validateSleeperRosterSnapshot(league, users, [rosters[0], rosters[0]]), /incomplete/);
  assert.throws(() => validateSleeperRosterSnapshot(league, users, [rosters[0], { ...rosters[1], players: ["a"] }]), /conflicting/);
});
