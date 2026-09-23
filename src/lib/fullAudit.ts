import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AuditNotFoundError } from "@/lib/auditSelection";
import { prisma } from "@/lib/prisma";
import { decodeFullAudit, type FullAuditData } from "@/lib/fullAuditFormat";

let fullAuditStorageReady: Promise<void> | undefined;
export function ensureFullAuditStorage() {
  return fullAuditStorageReady ??= initializeFullAuditStorage().catch(error => { fullAuditStorageReady = undefined; throw error; });
}
async function initializeFullAuditStorage() {
  await prisma.$transaction(async tx => {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(817264902)`);
  await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "FullAuditBundle" (id text PRIMARY KEY, "generatedAt" timestamptz NOT NULL, status text NOT NULL DEFAULT 'PENDING', manifest jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now())`);
  await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "FullAuditChunk" ("bundleId" text NOT NULL REFERENCES "FullAuditBundle"(id) ON DELETE CASCADE, name text NOT NULL, part integer NOT NULL, body bytea NOT NULL, PRIMARY KEY ("bundleId", name, part))`);
  await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "FullAuditFile" ("bundleId" text NOT NULL REFERENCES "FullAuditBundle"(id) ON DELETE CASCADE, name text NOT NULL, body bytea NOT NULL, PRIMARY KEY ("bundleId", name))`);
  });
}

export async function getFullAudit(id?: string): Promise<{ id: string; data: FullAuditData; published: boolean }> {
  let rows: Array<{ id: string; body: Uint8Array }> = [];
  if (id !== "reference") {
    try {
      rows = await prisma.$queryRawUnsafe(`SELECT b.id, f.body FROM "FullAuditBundle" b JOIN "FullAuditFile" f ON f."bundleId"=b.id AND f.name='tables.json.gz' WHERE b.status='COMPLETE' AND ($1::text IS NULL OR b.id=$1) ORDER BY b."generatedAt" DESC LIMIT 1`, id ?? null);
    } catch (error) {
      if (!JSON.stringify(error).includes("42P01")) throw error;
    }
  }
  if (rows[0]) return { id: rows[0].id, data: decodeFullAudit(Buffer.from(rows[0].body)), published: true };
  if (id && id !== "reference") throw new AuditNotFoundError("Research snapshot not found");
  return { id: "reference", data: decodeFullAudit(await readFile(join(process.cwd(), "public/audit/source-tables.json.gz"))), published: false };
}
