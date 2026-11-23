import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedConsensusSources } from "./marketEligibility";

test("legacy blends with removed sources cannot be displayed as current consensus", () => {
  assert.deepEqual(approvedConsensusSources('["KTC","DYNASTY_DEALER"]'), ["KTC", "DYNASTY_DEALER"]);
  assert.equal(approvedConsensusSources('["KTC","DYNASTY_DEALER","STATSGUY"]'), null);
  assert.equal(approvedConsensusSources('["KTC","STATSGUY"]'), null);
  assert.equal(approvedConsensusSources('invalid'), null);
});
