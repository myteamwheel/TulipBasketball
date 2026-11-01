import assert from "node:assert/strict";
import test from "node:test";
import { monitorRefresh } from "./refreshMonitor";

test("manual refresh waits through running responses and follows only the started run", async () => {
  const statuses = ["RUNNING", "RUNNING", "SUCCESS"];
  const seen: string[] = [];
  const result = await monitorRefresh("run-1", "owner-key", {
    signal: new AbortController().signal,
    pollMs: 0,
    onProgress: run => seen.push(run.status),
    fetcher: async (url, options) => {
      assert.equal(url, "/api/admin/refresh?runId=run-1");
      assert.deepEqual(options?.headers, { "x-admin-key": "owner-key" });
      assert.equal(options?.cache, "no-store");
      return Response.json({ run: { runId: "run-1", status: statuses.shift() } });
    },
  });
  assert.equal(result.status, "SUCCESS");
  assert.deepEqual(seen, ["RUNNING", "RUNNING", "SUCCESS"]);
});

test("partial failures and failures finish monitoring without being reported as success", async () => {
  for (const status of ["PARTIAL_FAILURE", "FAILED"] as const) {
    const run = await monitorRefresh("one", "key", { signal: new AbortController().signal, onProgress: () => {}, fetcher: async () => Response.json({ run: { runId: "one", status } }) });
    assert.equal(run.status, status);
  }
});

test("monitor rejects denied, mismatched, and invalid status responses", async () => {
  for (const response of [Response.json({ error: "Denied" }, { status: 401 }), Response.json({ run: { runId: "other", status: "SUCCESS" } }), Response.json({ run: { runId: "one", status: "unknown" } })]) {
    await assert.rejects(monitorRefresh("one", "key", { signal: new AbortController().signal, onProgress: () => assert.fail("Unverified status published"), fetcher: async () => response }));
  }
});

test("leaving the page cancels monitoring and a stuck run has a deadline", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(monitorRefresh("one", "key", {
    signal: controller.signal,
    onProgress: () => controller.abort(new Error("Unmounted")),
    fetcher: async () => { calls++; return Response.json({ run: { runId: "one", status: "RUNNING" } }); },
  }), /Unmounted/);
  assert.equal(calls, 1);
  await assert.rejects(monitorRefresh("one", "key", { signal: new AbortController().signal, timeoutMs: 0, onProgress: () => {}, fetcher: async () => assert.fail("Expired monitor sent a request") }), /longer than expected/);
});
