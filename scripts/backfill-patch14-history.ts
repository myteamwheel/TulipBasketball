import { prisma } from "../src/lib/prisma";
import { KTC_FORMAT } from "../src/lib/config";
import { normalizePlayerName } from "../src/lib/normalize";

type SeedRow = { name: string; position: string; value: number };

const JUNE_21_BASELINE: SeedRow[] = [
  { name: "Jordan Love", position: "QB", value: 5561 },
  { name: "Cam Ward", position: "QB", value: 5366 },
  { name: "Michael Penix Jr.", position: "QB", value: 3071 },
  { name: "Shedeur Sanders", position: "QB", value: 2707 },
  { name: "Carson Beck", position: "QB", value: 2099 },
  { name: "Cole Payton", position: "QB", value: 816 },
  { name: "Jeremiyah Love", position: "RB", value: 7571 },
  { name: "Quinshon Judkins", position: "RB", value: 5507 },
  { name: "Nicholas Singleton", position: "RB", value: 2916 },
  { name: "Ollie Gordon", position: "RB", value: 2398 },
  { name: "Mike Washington Jr.", position: "RB", value: 2286 },
  { name: "Keaton Mitchell", position: "RB", value: 2504 },
  { name: "Kaelon Black", position: "RB", value: 1760 },
  { name: "Emeka Egbuka", position: "WR", value: 6057 },
  { name: "Luther Burden", position: "WR", value: 5371 },
  { name: "Christian Watson", position: "WR", value: 3889 },
  { name: "Isaac TeSlaa", position: "WR", value: 2735 },
  { name: "Zachariah Branch", position: "WR", value: 2701 },
  { name: "De'Zhaun Stribling", position: "WR", value: 2693 },
  { name: "Caleb Douglas", position: "WR", value: 1317 },
  { name: "Malachi Fields", position: "WR", value: 2700 },
  { name: "Brenen Thompson", position: "WR", value: 1486 },
  { name: "Bryce Lance", position: "WR", value: 1345 },
  { name: "Colston Loveland", position: "TE", value: 6187 },
  { name: "Eli Stowers", position: "TE", value: 3589 },
  { name: "Oronde Gadsden", position: "TE", value: 3618 },
  { name: "Terrance Ferguson", position: "TE", value: 2668 },
  { name: "Max Klare", position: "TE", value: 1502 },
  { name: "Eli Raridon", position: "TE", value: 1162 },
];

// Exact values recoverable from the Aug. 13 ~2:58 a.m. ET checkpoint retained
// in the conversation. This intentionally stays partial: missing rows are not
// estimated or copied from another date.
const AUG_13_RECOVERED: SeedRow[] = [
  { name: "Quinshon Judkins", position: "RB", value: 5440 },
  { name: "Luther Burden", position: "WR", value: 5498 },
  { name: "Christian Watson", position: "WR", value: 3896 },
  { name: "Cam Ward", position: "QB", value: 5159 },
  { name: "Cole Payton", position: "QB", value: 861 },
  { name: "Caleb Douglas", position: "WR", value: 2393 },
  { name: "Michael Penix Jr.", position: "QB", value: 2798 },
  { name: "Zachariah Branch", position: "WR", value: 2914 },
  { name: "Brenen Thompson", position: "WR", value: 1783 },
];

async function insertCheckpoint(
  observedAt: Date,
  rows: SeedRow[],
  sourceType: "SEED_BASELINE" | "MANUAL_JSON",
  sourceUrl: string,
  validationNote: string,
) {
  const players = await prisma.player.findMany();
  const byKey = new Map<string, typeof players>();
  for (const player of players) {
    const key = `${player.normalizedName}|${player.position}`;
    const list = byKey.get(key) ?? [];
    list.push(player);
    byKey.set(key, list);
  }

  let inserted = 0;
  let existing = 0;
  const unresolved: string[] = [];
  for (const row of rows) {
    const key = `${normalizePlayerName(row.name)}|${row.position}`;
    const candidates = byKey.get(key) ?? [];
    if (candidates.length !== 1) {
      unresolved.push(`${row.name} (${row.position})`);
      continue;
    }
    const player = candidates[0];
    const already = await prisma.ktcObservation.findFirst({
      where: {
        playerId: player.id,
        observedAt: {
          gte: new Date(observedAt.getTime() - 60_000),
          lte: new Date(observedAt.getTime() + 60_000),
        },
        value: row.value,
      },
      select: { id: true },
    });
    if (already) {
      existing++;
      continue;
    }
    await prisma.ktcObservation.create({
      data: {
        playerId: player.id,
        value: row.value,
        format: KTC_FORMAT,
        observedAt,
        sourceType: sourceType as never,
        sourceUrl,
        importBatchId: `patch14:${observedAt.toISOString()}`,
        validationStatus: "VALID",
        validationNote,
      },
    });
    inserted++;
  }
  return { inserted, existing, unresolved };
}

async function main() {
  const baseline = await insertCheckpoint(
    new Date("2026-06-21T04:00:00.000Z"),
    JUNE_21_BASELINE,
    "SEED_BASELINE",
    "Patch14 authoritative handoff baseline: 2026-06-21",
    "Authoritative June 21 Orlando baseline retained from the dashboard build brief.",
  );
  const aug13 = await insertCheckpoint(
    new Date("2026-08-13T06:58:00.000Z"),
    AUG_13_RECOVERED,
    "MANUAL_JSON",
    "Patch14 recovered conversation checkpoint: 2026-08-13 02:58 ET",
    "One-time Patch 14 backfill from exact retained conversation values; only recovered rows inserted.",
  );
  console.log(JSON.stringify({ baseline, aug13 }, null, 2));
}

main().finally(async () => prisma.$disconnect());
