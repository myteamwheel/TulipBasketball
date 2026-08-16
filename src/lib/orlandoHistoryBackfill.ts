import { prisma } from "@/lib/prisma";
import { KTC_FORMAT } from "@/lib/config";
import { normalizePlayerName } from "@/lib/normalize";

type HistoricalRow = {
  name: string;
  position: "QB" | "RB" | "WR" | "TE";
  june7?: number;
  june21: number;
  aug13: number;
};

// Verified Orlando checkpoints retained from the original tracker/build brief.
// June 7 is intentionally partial. June 21 is complete and is the baseline.
const ORLANDO_HISTORY: HistoricalRow[] = [
  { name: "Jordan Love", position: "QB", june7: 5544, june21: 5561, aug13: 5388 },
  { name: "Cam Ward", position: "QB", june7: 5423, june21: 5366, aug13: 5159 },
  { name: "Michael Penix Jr.", position: "QB", june7: 3162, june21: 3071, aug13: 2798 },
  { name: "Shedeur Sanders", position: "QB", june7: 2747, june21: 2707, aug13: 2607 },
  { name: "Carson Beck", position: "QB", june7: 1812, june21: 2099, aug13: 3034 },
  { name: "Cole Payton", position: "QB", june21: 816, aug13: 861 },
  { name: "Jeremiyah Love", position: "RB", june7: 7617, june21: 7571, aug13: 7359 },
  { name: "Quinshon Judkins", position: "RB", june7: 5486, june21: 5507, aug13: 5440 },
  { name: "Nicholas Singleton", position: "RB", june7: 2949, june21: 2916, aug13: 2979 },
  { name: "Ollie Gordon", position: "RB", june7: 2343, june21: 2398, aug13: 2287 },
  { name: "Mike Washington Jr.", position: "RB", june7: 2381, june21: 2286, aug13: 2340 },
  { name: "Keaton Mitchell", position: "RB", june21: 2504, aug13: 2656 },
  { name: "Kaelon Black", position: "RB", june7: 1317, june21: 1760, aug13: 2224 },
  { name: "Emeka Egbuka", position: "WR", june7: 6072, june21: 6057, aug13: 6327 },
  { name: "Luther Burden", position: "WR", june7: 5374, june21: 5371, aug13: 5498 },
  { name: "Christian Watson", position: "WR", june7: 3767, june21: 3889, aug13: 3896 },
  { name: "Isaac TeSlaa", position: "WR", june7: 2811, june21: 2735, aug13: 2682 },
  { name: "Zachariah Branch", position: "WR", june7: 2695, june21: 2701, aug13: 2914 },
  { name: "De'Zhaun Stribling", position: "WR", june7: 2519, june21: 2693, aug13: 3263 },
  { name: "Caleb Douglas", position: "WR", june7: 1159, june21: 1317, aug13: 2393 },
  { name: "Malachi Fields", position: "WR", june7: 2678, june21: 2700, aug13: 2680 },
  { name: "Brenen Thompson", position: "WR", june21: 1486, aug13: 1783 },
  { name: "Bryce Lance", position: "WR", june21: 1345, aug13: 1823 },
  { name: "Colston Loveland", position: "TE", june7: 6121, june21: 6187, aug13: 6290 },
  { name: "Eli Stowers", position: "TE", june7: 3732, june21: 3589, aug13: 3295 },
  { name: "Oronde Gadsden", position: "TE", june7: 3619, june21: 3618, aug13: 3362 },
  { name: "Terrance Ferguson", position: "TE", june7: 2623, june21: 2668, aug13: 2802 },
  { name: "Max Klare", position: "TE", june7: 1502, june21: 1502, aug13: 2212 },
  { name: "Eli Raridon", position: "TE", june21: 1162, aug13: 2345 },
];

const JUNE_7 = new Date("2026-06-07T04:00:00.000Z");
const JUNE_21 = new Date("2026-06-21T04:00:00.000Z");
const AUG_13 = new Date("2026-08-13T06:58:00.000Z");
const COMPLETION_BATCH = "orlando-history-v2-june21-baseline";
const EXPECTED_CANONICAL_ROWS =
  ORLANDO_HISTORY.length * 2 + ORLANDO_HISTORY.filter((row) => row.june7 !== undefined).length;

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
    canonical.importBatchId !== COMPLETION_BATCH ||
    canonical.sourceType !== args.sourceType;

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
        validationNote: `Superseded duplicate of canonical Orlando checkpoint ${args.observedAt.toISOString()}.`,
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
    label: "June 7" | "June 21" | "August 13",
  ) => {
    const key = `${normalizePlayerName(row.name)}|${row.position}`;
    const candidates = byKey.get(key) ?? [];
    if (candidates.length !== 1) {
      result.unresolved.push(`${label}: ${row.name} (${row.position})`);
      return;
    }

    const sourceUrl =
      label === "June 7"
        ? "Verified Orlando tracker checkpoint: 2026-06-07 (partial pre-baseline history)"
        : label === "June 21"
          ? "Authoritative Orlando baseline checkpoint: 2026-06-21"
          : "Verified Orlando tracker checkpoint: 2026-08-13 02:58 ET";
    const validationNote =
      label === "June 7"
        ? "Exact June 7 value where supplied; retained only as partial pre-baseline history."
        : label === "June 21"
          ? "Exact June 21 Orlando Oswalds KTC baseline from the complete 29-player build-brief seed table."
          : "Exact August 13 Orlando Oswalds KTC checkpoint recovered from the retained tracker conversation.";

    const canonical = await canonicalizeObservation({
      playerId: candidates[0].id,
      value,
      observedAt,
      sourceType,
      sourceUrl,
      validationNote,
    });
    result.inserted += canonical.inserted;
    result.corrected += canonical.corrected;
    result.unchanged += canonical.unchanged;
    result.duplicatesRejected += canonical.duplicatesRejected;
  };

  for (const row of ORLANDO_HISTORY) {
    if (row.june7 !== undefined) await apply(row, JUNE_7, row.june7, "MANUAL_JSON", "June 7");
    await apply(row, JUNE_21, row.june21, "SEED_BASELINE", "June 21");
    await apply(row, AUG_13, row.aug13, "MANUAL_JSON", "August 13");
  }

  return result;
}

export const ORLANDO_HISTORY_BACKFILL_EXPECTED_ROWS = EXPECTED_CANONICAL_ROWS;
