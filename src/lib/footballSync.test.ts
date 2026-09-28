import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/postgres";
process.env.RECOVERY_DATABASE_URL ??= "postgresql://user:pass@localhost:5432/postgres";

test("NFLverse passing interceptions use the official source column", async () => {
  const { nflversePassingInterceptions } = await import("./footballSync");

  assert.equal(
    nflversePassingInterceptions({ passing_interceptions: "2" }),
    2,
  );
});

test("NFLverse interception schema drift cannot silently become zero", async () => {
  const { nflversePassingInterceptions } = await import("./footballSync");

  assert.throws(
    () => nflversePassingInterceptions({ interceptions: "2" }),
    /missing passing_interceptions/,
  );
});
