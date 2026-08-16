import { prisma } from "../src/lib/prisma";
import { ensureOrlandoHistoryBackfill, ORLANDO_HISTORY_BACKFILL_EXPECTED_ROWS } from "../src/lib/orlandoHistoryBackfill";

async function main() {
  const result = await ensureOrlandoHistoryBackfill();
  console.log(JSON.stringify({ expectedCanonicalRows: ORLANDO_HISTORY_BACKFILL_EXPECTED_ROWS, ...result }, null, 2));
}

main().finally(async () => prisma.$disconnect());
