import Link from "next/link";
import SectionHeader from "@/components/SectionHeader";
import { ensureAnalyticsStorage } from "@/lib/weeklyProjection";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DataExportPage() {
  await ensureAnalyticsStorage();
  const [snapshots, projections] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ count: bigint; first: Date | null; last: Date | null }>>(
      `SELECT COUNT(*)::bigint AS count, MIN("snapshotDate") AS first, MAX("snapshotDate") AS last FROM "DailyExportSnapshot"`,
    ),
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "WeeklyProjection"`,
    ),
  ]);
  const snapshot = snapshots[0];

  return (
    <div className="min-w-0 space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-neutral-100 sm:text-2xl">
          Full Data Export
        </h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
          Download a complete Excel workbook rebuilt from the dashboard&apos;s
          retained history. The database stays canonical and append-oriented, so
          each export contains everything currently recorded rather than relying
          on one binary spreadsheet file being updated in place.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <SectionHeader
          title="Excel workbook"
          description="Includes refresh history, current and historical rosters, KTC, independent market feeds, consensus, transactions, football profiles, NFL game stats, signals, weekly projections, and projection accuracy."
        />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/api/export/all-data"
            className="w-fit rounded-md border border-emerald-800 bg-emerald-950/30 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-950/50"
          >
            Download complete .xlsx
          </Link>
          <div className="text-[10px] leading-4 text-neutral-500">
            {Number(snapshot?.count ?? 0).toLocaleString("en-US")} daily audit snapshots ·{" "}
            {Number(projections[0]?.count ?? 0).toLocaleString("en-US")} saved projection rows
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-5 text-neutral-500">
        <div className="font-semibold text-neutral-300">Daily write behavior</div>
        <p className="mt-1">
          The 8 a.m. refresh writes new market, roster, transaction, game, and
          projection observations into the historical database and records a
          DailyExportSnapshot. The Excel file is generated from that full history
          whenever you click export, which prevents a corrupted or missed file
          write from becoming a single point of failure.
        </p>
      </section>
    </div>
  );
}
