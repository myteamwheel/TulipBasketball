import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

export const dynamic = "force-dynamic";

async function projectionCount() {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      'SELECT COUNT(*)::int AS count FROM "WeeklyPlayerProjection"',
    );
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

export default async function ExportsPage() {
  const [refreshes, ktc, market, rosters, games, projections, latest] =
    await Promise.all([
      prisma.refreshRun.count({
        where: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
      }),
      prisma.ktcObservation.count(),
      prisma.marketObservation.count(),
      prisma.rosterSnapshot.count({
        where: { manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
      }),
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        'SELECT COUNT(*)::int AS count FROM "PlayerGameStat"',
      ),
      projectionCount(),
      prisma.refreshRun.findFirst({
        where: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true, status: true },
      }),
    ]);

  const gameCount = Number(games[0]?.count ?? 0);
  const latestLabel = latest
    ? latest.status.replaceAll("_", " ").toLowerCase() +
      " · " +
      latest.startedAt.toLocaleString("en-US", {
        timeZone: "America/New_York",
      }) +
      " ET"
    : "none recorded";

  return (
    <div className="min-w-0 space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-neutral-100 sm:text-2xl">
          Data Export
        </h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
          Download the complete Dynasty Boys history as a real Excel workbook.
          The file is generated from the database at click time, so every daily
          refresh is automatically included without maintaining a fragile
          separate spreadsheet copy.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-neutral-100">
          Complete Excel history
        </h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">
          Includes players, managers, roster history, ownership history, KTC,
          every market-source observation, consensus history, draft-pick
          history, football profiles, NFL game stats, current weekly forecasts,
          saved projection snapshots, projection accuracy, transactions,
          refresh runs, signals, and notes.
        </p>
        <a
          href="/api/export/all-data"
          className="mt-4 inline-flex rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
        >
          Download complete history (.xlsx)
        </a>
        <p className="mt-3 text-[10px] leading-4 text-neutral-600">
          The workbook is rebuilt from persisted history on every download.
          Historical source rows are never replaced just to make the export look
          cleaner. New projection snapshots are appended by the same morning
          refresh that updates the rest of the dashboard.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">
          Persisted history currently available
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            ["Daily refreshes", refreshes],
            ["KTC observations", ktc],
            ["Market observations", market],
            ["Roster snapshots", rosters],
            ["NFL game rows", gameCount],
            ["Saved projections", projections],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-md bg-neutral-950 p-3">
              <div className="text-[9px] uppercase tracking-wide text-neutral-600">
                {label}
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-neutral-100">
                {Number(value).toLocaleString("en-US")}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-neutral-600">
          Latest refresh: {latestLabel}
        </p>
      </section>
    </div>
  );
}
