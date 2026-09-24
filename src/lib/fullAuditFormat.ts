import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

export const AUDIT_FILES = ["tables.json.gz", "Dynasty-Bois-Data.xlsx", "Dynasty-Bois-Report.pdf"] as const;
export const fullAuditManifest = z.object({
  leagueId: z.literal("1312155271526625280"),
  generatedAt: z.string().datetime({ offset: true }),
  freshInputs: z.literal(true),
  tableCount: z.literal(80),
  files: z.record(z.string(), z.object({ bytes: z.number().int().positive().max(16 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) })),
}).passthrough();

export type FullAuditData = {
  version: number;
  leagueId: string;
  generatedAt: string;
  freshInputs: boolean;
  collegeBaseline: string;
  comparedWith: string | null;
  changes: Array<{ table: string; previousRows: number | null; currentRows: number; addedOrChanged: number; removedOrChanged: number }>;
  tables: Array<{ name: string; report: string; kind: string; description: string; rows: Array<Record<string, unknown>> }>;
};

const fullAuditDataSchema = z.object({
  version: z.literal(1), leagueId: z.literal("1312155271526625280"),
  generatedAt: z.string().datetime({ offset: true }), freshInputs: z.boolean(),
  collegeBaseline: z.string(), comparedWith: z.string().datetime({ offset: true }).nullable(),
  changes: z.array(z.object({ table: z.string(), previousRows: z.number().int().nonnegative().nullable(), currentRows: z.number().int().nonnegative(), addedOrChanged: z.number().int().nonnegative(), removedOrChanged: z.number().int().nonnegative() })),
  tables: z.array(z.object({ name: z.string().min(1), report: z.string(), kind: z.string(), description: z.string(), rows: z.array(z.record(z.string(), z.unknown())) })).length(80),
});

export function decodeFullAudit(bytes: Buffer): FullAuditData {
  const value = fullAuditDataSchema.parse(JSON.parse(gunzipSync(bytes, { maxOutputLength: 48 * 1024 * 1024 }).toString()));
  if (value.leagueId !== "1312155271526625280" || !Array.isArray(value.tables) || value.tables.length !== 80) throw new Error("Invalid Dynasty Bois research bundle");
  const names = new Set<string>();
  for (const table of value.tables) {
    if (typeof table.name !== "string" || names.has(table.name) || !Array.isArray(table.rows)) throw new Error("Invalid research table");
    names.add(table.name);
    for (const row of table.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid research row");
      if (row.league && row.league !== "Dynasty Bois") throw new Error("Research bundle contains another league");
    }
  }
  return value;
}

export function validateFullAuditFiles(rawManifest: unknown, files: Map<string, Buffer>) {
  const manifest = fullAuditManifest.parse(rawManifest);
  if (Object.keys(manifest.files).length !== AUDIT_FILES.length) throw new Error("Unexpected audit files");
  for (const name of AUDIT_FILES) {
    const spec = manifest.files[name], body = files.get(name);
    if (!spec || !body || body.length !== spec.bytes || createHash("sha256").update(body).digest("hex") !== spec.sha256) throw new Error(`Audit checksum failed: ${name}`);
  }
  if (!files.get("Dynasty-Bois-Data.xlsx")!.subarray(0, 2).equals(Buffer.from("PK")) || !files.get("Dynasty-Bois-Report.pdf")!.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Invalid audit download format");
  const data = decodeFullAudit(files.get("tables.json.gz")!);
  if (!data.freshInputs || data.generatedAt !== manifest.generatedAt || data.tables.length !== manifest.tableCount) throw new Error("Audit metadata does not match its data");
  return { manifest, data };
}
