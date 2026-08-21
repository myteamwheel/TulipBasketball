import assert from "node:assert/strict";
import test from "node:test";
import {
  requireCompleteTradyrAccess,
  tradyrRequestHeaders,
} from "@/lib/tradyrAccess";

test("Tradyr API key is sent only as a bearer header", () => {
  assert.equal(tradyrRequestHeaders(null).Authorization, undefined);
  assert.equal(
    tradyrRequestHeaders("try_live_example").Authorization,
    "Bearer try_live_example",
  );
});

test("anonymous first-page-only access fails with an actionable message", () => {
  assert.throws(
    () =>
      requireCompleteTradyrAccess(
        { limited: true, reason: "unkeyed_request", offsetIgnored: true },
        false,
      ),
    /Configure TRADYR_API_KEY/,
  );
});

test("a rejected configured key never falls back to partial data", () => {
  assert.throws(
    () => requireCompleteTradyrAccess({ limited: true }, true),
    /rejected or limited/,
  );
  assert.doesNotThrow(() => requireCompleteTradyrAccess(undefined, true));
});
