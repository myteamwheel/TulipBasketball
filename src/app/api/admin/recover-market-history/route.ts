import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { KTC_FORMAT } from "@/lib/config";
import { recordAuditSnapshot } from "@/lib/audit";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// This route is deliberately narrow: it exists to recover the verified
// history in the owner's September 23 dashboard export after the former
// database became unavailable. It cannot update or delete observations.
const RECOVERY_BATCH = "user-export-recovery-2026-09-23";
const RECOVERY_SOURCE = "Dynasty_Boys_Full_Data_2026-09-23.xlsx";
const recoveryInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("records"),
    batch: z.literal(RECOVERY_BATCH),
    records: z.array(z.object({
      sleeperId: z.string().min(1).max(64),
      observedAt: z.string().datetime(),
      value: z.number().int().min(1).max(10000),
    })).min(1).max(600),
  }),
  z.object({ action: z.literal("finalize"), batch: z.literal(RECOVERY_BATCH) }),
]);

function authorized(request: Request) {
  const expected = process.env.AUDIT_INGEST_TOKEN ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return expected.length >= 32 && Buffer.byteLength(expected) === Buffer.byteLength(supplied)
    && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let parsed: ReturnType<typeof recoveryInput.safeParse>;
  try { parsed = recoveryInput.safeParse(await request.json()); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "Invalid recovery records" }, { status: 400 });
  if (parsed.data.action === "finalize") {
    const snapshot = await recordAuditSnapshot(null);
    return Response.json({ ok: true, snapshotId: snapshot.snapshotId, generatedAt: snapshot.generatedAt }, { headers: { "Cache-Control": "no-store" } });
  }

  const records = parsed.data.records;
  const now = Date.now();
  const oldestAllowed = Date.parse("2026-06-01T00:00:00.000Z");
  if (records.some(record => {
    const at = Date.parse(record.observedAt);
    return !Number.isFinite(at) || at < oldestAllowed || at > now + 15 * 60_000;
  })) return Response.json({ error: "Recovery dates are outside the permitted export window" }, { status: 422 });

  const unique = new Map<string, typeof records[number]>();
  for (const record of records) unique.set(`${record.sleeperId}:${record.observedAt}`, record);
  const normalized = [...unique.values()];
  const players = await prisma.player.findMany({
    where: { sleeperId: { in: [...new Set(normalized.map(record => record.sleeperId))] } },
    select: { id: true, sleeperId: true },
  });
  const playerBySleeperId = new Map(players.map(player => [player.sleeperId, player]));
  const times = normalized.map(record => Date.parse(record.observedAt));
  const existing = players.length ? await prisma.ktcObservation.findMany({
    where: {
      playerId: { in: players.map(player => player.id) },
      observedAt: { gte: new Date(Math.min(...times) - 1000), lte: new Date(Math.max(...times) + 1000) },
    },
    select: { playerId: true, observedAt: true },
  }) : [];
  const existingByPlayer = new Map<string, number[]>();
  for (const observation of existing) {
    const dates = existingByPlayer.get(observation.playerId) ?? [];
    dates.push(observation.observedAt.getTime());
    existingByPlayer.set(observation.playerId, dates);
  }

  let unresolved = 0;
  let alreadyPresent = 0;
  const inserts: Array<{ playerId: string; value: number; observedAt: Date; format: string; sourceType: "MANUAL_CSV"; sourceUrl: string; importBatchId: string; validationStatus: "VALID"; validationNote: string }> = [];
  for (const record of normalized) {
    const player = playerBySleeperId.get(record.sleeperId);
    if (!player) { unresolved += 1; continue; }
    const observedAt = new Date(record.observedAt);
    if ((existingByPlayer.get(player.id) ?? []).some(storedAt => Math.abs(storedAt - observedAt.getTime()) <= 1000)) {
      alreadyPresent += 1;
      continue;
    }
    inserts.push({
      playerId: player.id,
      value: record.value,
      observedAt,
      format: KTC_FORMAT,
      sourceType: "MANUAL_CSV",
      sourceUrl: RECOVERY_SOURCE,
      importBatchId: RECOVERY_BATCH,
      validationStatus: "VALID",
      validationNote: "Recovered append-only from the owner-provided dashboard export; original observation time preserved.",
    });
  }
  if (inserts.length) await prisma.ktcObservation.createMany({ data: inserts });
  return Response.json({ received: records.length, unique: normalized.length, inserted: inserts.length, alreadyPresent, unresolved }, { headers: { "Cache-Control": "no-store" } });
}
