import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureFullAuditStorage } from "@/lib/fullAudit";
import { recordAuditSnapshot } from "@/lib/audit";
import { AUDIT_FILES, fullAuditManifest, validateFullAuditFiles } from "@/lib/fullAuditFormat";

export const maxDuration = 60;
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), id: z.string().uuid(), manifest: fullAuditManifest }),
  z.object({ action: z.literal("chunk"), id: z.string().uuid(), name: z.enum(AUDIT_FILES), part: z.number().int().min(0).max(31), body: z.string().max(700000).regex(/^[A-Za-z0-9+/]*={0,2}$/) }),
  z.object({ action: z.literal("finish"), id: z.string().uuid() }),
]);

export async function POST(request: Request) {
  const configured = process.env.AUDIT_INGEST_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!configured || configured.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(configured) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(configured))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 750000) return Response.json({ error: "Chunk too large" }, { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text) > 750000) return Response.json({ error: "Chunk too large" }, { status: 413 });
  let parsed: ReturnType<typeof input.safeParse>;
  try { parsed = input.safeParse(JSON.parse(text)); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "Invalid audit upload" }, { status: 400 });
  const data = parsed.data;
  await ensureFullAuditStorage();
  if (data.action === "begin") {
    const age = Date.now() - Date.parse(data.manifest.generatedAt);
    if (age < -300000 || age > 36 * 3600000) return Response.json({ error: "Audit is not current" }, { status: 422 });
    await prisma.$executeRawUnsafe(`INSERT INTO "FullAuditBundle" (id, "generatedAt", manifest) VALUES ($1,$2::timestamptz,$3::jsonb) ON CONFLICT (id) DO NOTHING`, data.id, data.manifest.generatedAt, JSON.stringify(data.manifest));
    return Response.json({ ok: true });
  }
  const bundles = await prisma.$queryRawUnsafe<Array<{ status: string; manifest: unknown }>>(`SELECT status, manifest FROM "FullAuditBundle" WHERE id=$1`, data.id);
  if (!bundles[0]) return Response.json({ error: "Unknown upload" }, { status: 404 });
  if (bundles[0].status === "COMPLETE") return Response.json({ ok: true, complete: true });
  if (data.action === "chunk") {
    const body = Buffer.from(data.body, "base64");
    if (!body.length || body.length > 512 * 1024) return Response.json({ error: "Invalid chunk size" }, { status: 413 });
    await prisma.$executeRawUnsafe(`INSERT INTO "FullAuditChunk" ("bundleId",name,part,body) VALUES ($1,$2,$3,$4) ON CONFLICT ("bundleId",name,part) DO UPDATE SET body=EXCLUDED.body`, data.id, data.name, data.part, body);
    return Response.json({ ok: true });
  }
  const chunks = await prisma.$queryRawUnsafe<Array<{ name: string; part: number; body: Uint8Array }>>(`SELECT name, part, body FROM "FullAuditChunk" WHERE "bundleId"=$1 ORDER BY name, part`, data.id);
  const files = new Map<string, Buffer>();
  for (const name of AUDIT_FILES) {
    const parts = chunks.filter(chunk => chunk.name === name);
    if (!parts.length || parts.some((part, index) => part.part !== index)) return Response.json({ error: "Missing audit chunks" }, { status: 422 });
    files.set(name, Buffer.concat(parts.map(part => Buffer.from(part.body))));
  }
  try { validateFullAuditFiles(bundles[0].manifest, files); }
  catch { return Response.json({ error: "Audit validation failed; previous publication retained" }, { status: 422 }); }
  await prisma.$transaction(async transaction => {
    for (const [name, body] of files) await transaction.$executeRawUnsafe(`INSERT INTO "FullAuditFile" ("bundleId",name,body) VALUES ($1,$2,$3) ON CONFLICT ("bundleId",name) DO NOTHING`, data.id, name, body);
    await transaction.$executeRawUnsafe(`UPDATE "FullAuditBundle" SET status='COMPLETE' WHERE id=$1`, data.id);
    await transaction.$executeRawUnsafe(`DELETE FROM "FullAuditChunk" WHERE "bundleId"=$1`, data.id);
  }, { timeout: 30000 });
  let overviewSnapshot: string | null = null;
  let overviewWarning: string | null = null;
  try { overviewSnapshot = (await recordAuditSnapshot(null)).snapshotId ?? null; }
  catch (error) { overviewWarning = error instanceof Error ? error.message : "Overview snapshot validation failed"; }
  return Response.json({ ok: true, id: data.id, complete: true, overviewSnapshot, overviewWarning });
}
