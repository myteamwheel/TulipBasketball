import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { decodeFullAudit, validateFullAuditFiles } from "./fullAuditFormat";
import { isAuditSelector } from "./auditSelection";

function fixture() {
  const data = { version: 1, leagueId: "1312155271526625280", generatedAt: "2026-09-23T12:00:00Z", freshInputs: true, collegeBaseline: "2026-08-19", comparedWith: null, changes: [], tables: Array.from({ length: 70 }, (_, i) => ({ name: `table_${i}`, report: "Test", kind: "result", description: "Test", rows: [{ league: "Dynasty Bois", value: 10 }] })) };
  const files = new Map<string, Buffer>([["tables.json.gz", gzipSync(JSON.stringify(data))], ["Dynasty-Bois-Data.xlsx", Buffer.from("PK-workbook")], ["Dynasty-Bois-Report.pdf", Buffer.from("%PDF-report")]]);
  const manifest = { leagueId: data.leagueId, generatedAt: data.generatedAt, freshInputs: true, tableCount: data.tables.length, files: Object.fromEntries([...files].map(([name, body]) => [name, { bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") }])) };
  return { data, files, manifest };
}

test("publication requires every file and exact matching checksums", () => {
  const { files, manifest } = fixture();
  assert.equal(validateFullAuditFiles(manifest, files).data.tables.length, 70);
  files.set("Dynasty-Bois-Report.pdf", Buffer.from("%PDF-altered"));
  assert.throws(() => validateFullAuditFiles(manifest, files), /checksum/);
  files.delete("tables.json.gz");
  assert.throws(() => validateFullAuditFiles(manifest, files), /checksum/);
});

test("research upload rejects cross-league rows and duplicate tables", () => {
  const { data } = fixture();
  data.tables[0].rows[0].league = "Another league";
  assert.throws(() => decodeFullAudit(gzipSync(JSON.stringify(data))), /another league/);
  data.tables[0].rows[0].league = "Dynasty Bois";
  data.tables[1].name = data.tables[0].name;
  assert.throws(() => decodeFullAudit(gzipSync(JSON.stringify(data))), /Invalid research table/);
});

test("cached-input runs cannot be published as a fresh audit", () => {
  const { files, manifest } = fixture();
  assert.throws(() => validateFullAuditFiles({ ...manifest, freshInputs: false }, files));
});

test("snapshot selectors accept immutable ids and real dates only", () => {
  assert.equal(isAuditSelector("2026-09-23"), true);
  assert.equal(isAuditSelector("2026-02-30"), false);
  assert.equal(isAuditSelector("2026-09-23\r\nInjected: x"), false);
  assert.equal(isAuditSelector("2b2dfe02-0580-4e87-9c78-caf497f1c6a3"), true);
});
