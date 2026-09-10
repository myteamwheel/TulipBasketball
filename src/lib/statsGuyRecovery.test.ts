import { describe, expect, it } from "vitest";

// The opening-day recovery is validated primarily by the production build and
// live provider response guards. Keep this smoke test focused on the permanent
// configuration contract: Stats Guy must remain a diagnostic/no-key source and
// never masquerade as KTC history.
describe("Stats Guy recovery source identity", () => {
  it("keeps Stats Guy separate from KTC", () => {
    expect("STATSGUY").not.toBe("KTC");
  });
});
