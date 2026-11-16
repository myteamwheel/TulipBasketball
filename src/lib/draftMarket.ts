import { prisma } from "./prisma";
import { KTC_FORMAT } from "./config";
import type { Quote } from "./draftGrades";

/** Only promote a validated KTC quote with an effective source date, never a consensus value. */
export async function currentDraftQuotes(ids: string[]) {
  const result = new Map<string,Quote>();
  if (!process.env.DATABASE_URL) return result;
  try {
    const rows = await prisma.$queryRaw<{ sleeperId:string; value:number; at:Date }[]>`
      SELECT DISTINCT ON (p."sleeperId") p."sleeperId", k.value, k."observedAt" AS at
      FROM "KtcObservation" k JOIN "Player" p ON p.id=k."playerId"
      WHERE p."sleeperId" = ANY(${ids}::text[]) AND k.format=${KTC_FORMAT}
      AND k."validationStatus"='VALID' AND k.value BETWEEN 0 AND 9999
      AND k."observedAt" BETWEEN NOW() - INTERVAL '48 hours' AND NOW()
      ORDER BY p."sleeperId", k."observedAt" DESC, k."createdAt" DESC`;
    for (const row of rows) result.set(row.sleeperId,{value:row.value,date:row.at.toISOString().slice(0,10)});
  } catch { /* The verified daily archive carries its own observation dates. */ }
  return result;
}
