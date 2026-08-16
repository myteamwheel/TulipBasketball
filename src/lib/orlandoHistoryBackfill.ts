import { prisma } from "@/lib/prisma";
import { KTC_FORMAT } from "@/lib/config";
import { normalizePlayerName } from "@/lib/normalize";

type HistoricalRow = {
  name: string;
  position: "QB" | "RB" | "WR" | "TE";
  june7?: number;
  aug13: number;
};

// Exact Orlando Oswalds values retained from the June 7 -> August 13 tracker.
// A missing june7 value means the original tracker explicitly showed N/A; it is
// deliberately left absent rather than guessed from June 21 or another date.
const ORLANDO_HISTORY: HistoricalRow[] = [
  { name: "Jordan Love", position: "QB", june7: 5544, aug13: 5388 },
  { name: "Cam Ward", position: "QB", june7: 5423, aug13: 5159 },
  { name: "Michael Penix Jr.", position: "QB", june7: 3162, aug13: 2798 },
  { name: "Shedeur Sanders", position: "QB", june7: 2747, aug13: 2607 },
  { name: "Carson Beck", position: "QB", june7: 1812, aug13: 3034 },
  { name: "Cole Payton", position: "QB", aug13: 861 },
  { name: "Jeremiyah Love", position: "RB", june7: 7617, aug13: 7359 },
  { name: "Quinshon Judkins", position: "RB", june7: 5486, aug13: 5440 },
  { name: "Nicholas Singleton", position: "RB", june7: 2949, aug13: 2979 },
  { name: "Ollie Gordon", position: "RB", june7: 2343, aug13: 2287 },
  { name: "Mike Washington Jr.", position: "RB", june7: 2381, aug13: 2340 },
  { name: "Keaton Mitchell", position: "RB", aug13: 2656 },
  { name: "Kaelon Black", position: "RB", june7: 1317, aug13: 2224 },
  { name: "Emeka Egbuka", position: "WR", june7: 6072, aug13: 6327 },
  { name: "Luther Burden", position: "WR", june7: 5374, aug13: 5498 },
  { name: "Christian Watson", position: "WR", june7: 3767, aug13: 3896 },
  { name: "Isaac TeSlaa", position: "WR", june7: 2811, aug13: 2682 },
  { name: "Zachariah Branch", position: "WR", june7: 2695, aug13: 2914 },
  { name: "De'Zhaun Stribling", position: "WR", june7: 2519, aug13: 3263 },
  { name: "Caleb Douglas", position: "WR", june7: 1159, aug13: 2393 },
  { name: "Malachi Fields", position: "WR", june7: 2678, aug13: 2680 },
  { name: "Brenen Thompson", position: "WR", aug13: 1783 },
  { name: "Bryce Lance", position: "WR", aug13: 1823 },
  { name: "Colston Loveland", position: "TE", june7: 6121, aug13: 6290 },
  { name: "Eli Stowers", position: "TE", june7: 3732, aug13: 3295 },
  { name: "Oronde Gadsden", position: "TE", june7: 3619, aug13: 3362 },
  { name: "Terrance Ferguson", position: "TE", june7: 2623, aug13: 2802 },
  { name: "Max Klare", position: "TE", june7: 1502, aug13: 2212 },
  { name: "Eli Raridon", position: "TE", aug13: 2345 },
];

const JUNE_7 = new Date("2026-06-07T04:00:00.000Z");
const AUG_13 = new Date("2026-08-13T06:58:00.000Z");
const COMPLETION_BATCH = "orlando-history-v1";
const EXPECTED_CANONICAL_ROWS = ORLANDO_HISTORY.length + ORLANDO_HISTORY.filter((row) => row.june7 !== undefined).length;

type BackfillResult = {
  alreadyComplete: boolean;
  inserted: number;
  corrected: number;
  unchanged: number;
  duplicatesRejected: number;
  unresolved: string[];
};

async function canonicalizeObservation(args: {
  playerId: string;
  value: number;
  observedAt: Date;
  sourceType: "SEED_BASELINE" | "MANUAL_JSON";
  sourceUrl: string;
  validationNote: string;
}) {
  const windowMs = 60_000;
  const existing = await prisma.ktcObservation.findMany({
    where: {
      playerId: args.playerId,
      observedAt: {
        gte: new Date(args.observedAt.getTime() - windowMs),
        lte: new Date(args.observedAt.getTime() + windowMs),
      },
    },
    orderBy: [{ observedAt: "asc" }, { id: "asc" }],
  });

  if (existing.length === 0) {
    await prisma.ktcObservation.create({
      data: {
        playerId: args.playerId,
        value: args.value,
        format: KTC_FORMAT,
        observedAt: args.observedAt,
        sourceType: args.sourceType as never,
        sourceUrl: args.sourceUrl,
        importBatchId: COMPLETION_BATCH,
        validationStatus: "VALID",
        validationNote: args.validationNote,
      },
    });
    return { inserted: 1, corrected: 0, unchanged: 0, duplicatesRejected: 0 };
  }

  const canonical = existing[0];
  const needsCorrection =
    canonical.value !== args.value ||
    canonical.observedAt.getTime() !== args.observedAt.getTime() ||
    canonical.validationStatus !== "VALID" ||
    canonical.format !== KTC_FORMAT ||
    canonical.importBatchId !== COMPLETION_BATCH;

  await prisma.ktcObservation.update({
    where: { id: canonical.id },
    data: {
      value: args.value,
      format: KTC_FORMAT,
      observedAt: args.observedAt,
      sourceType: args.sourceType as never,
      sourceUrl: args.sourceUrl,
      importBatchId: COMPLETION_BATCH,
      validationStatus: "VALID",
      validationNote: args.validationNote,
    },
  });

  let duplicatesRejected = 0;
  for (const duplicate of existing.slice(1)) {
    await prisma.ktcObservation.update({
      where: { id: duplicate.id },
      data: {
        validationStatus: "REJECTED",
        validationNote: `Superseded duplicate of the canonical Orlando historical checkpoint ${args.observedAt.toISOString()}.`,
      },
    });
    duplicatesRejected++;
  }

  return {
    inserted: 0,
    corrected: needsCorrection ? 1 : 0,
    unchanged: needsCorrection ? 0 : 1,
    duplicatesRejected,
  };
}

export async function ensureOrlandoHistoryBackfill(): Promise<BackfillResult> {
  const completed = await prisma.ktcObservation.count({
    where: { importBatchId: COMPLETION_BATCH, validationStatus: "VALID" },
  });
  if (completed >= EXPECTED_CANONICAL_ROWS) {
    return { alreadyComplete: true, inserted: 0, corrected: 0, unchanged: 0, duplicatesRejected: 0, unresolved: [] };
  }

  const players = await prisma.player.findMany();
  const byKey = new Map<string, typeof players>();
  for (const player of players) {
    const key = `${player.normalizedName}|${player.position}`;
    const list = byKey.get(key) ?? [];
    list.push(player);
    byKey.set(key, list);
  }

  const result: BackfillResult = {
    alreadyComplete: false,
    inserted: 0,
    corrected: 0,
    unchanged: 0,
    duplicatesRejected: 0,
    unresolved: [],
  };

  const apply = async (
    row: HistoricalRow,
    observedAt: Date,
    value: number,
    sourceType: "SEED_BASELINE" | "MANUAL_JSON",
    label: string,
  ) => {
    const key = `${normalizePlayerName(row.name)}|${row.position}`;
    const candidates = byKey.get(key) ?? [];
    if (candidates.length !== 1) {
      result.unresolved.push(`${label}: ${row.name} (${row.position})`);
      return;
    }

    const r = await canonicalizeObservation({
      playerId: candidates[0].id,
      value,
      observedAt,
      sourceType,
      sourceUrl: label === "June 7" ? "Authoritative Orlando tracker checkpoint: 2026-06-07" : "Authoritative Orlando tracker checkpoint: 2026-08-13 02:58 ET",
      validationNote: label === "June 7"
        ? "Exact June 7 Orlando Oswalds KTC baseline recovered from the retained tracker conversation."
        : "Exact August 13 Orlando Oswalds KTC checkpoint recovered from the retained tracker conversation.",
    });
    result.inserted += r.inserted;
    result.corrected += r.corrected;
    result.unchanged += r.unchanged;
    result.duplicatesRejected += r.duplicatesRejected;
  };

  for (const row of ORLANDO_HISTORY) {
    if (row.june7 !== undefined) await apply(row, JUNE_7, row.june7, "SEED_BASELINE", "June 7");
    await apply(row, AUG_13, row.aug13, "MANUAL_JSON", "August 13");
  }

  return result;
}

export const ORLANDO_HISTORY_BACKFILL_EXPECTED_ROWS = EXPECTED_CANONICAL_ROWS;
