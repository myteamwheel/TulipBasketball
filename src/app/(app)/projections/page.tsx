import MetricCard from "@/components/MetricCard";
import SectionHeader from "@/components/SectionHeader";
import WeeklyProjectionBoard from "@/components/WeeklyProjectionBoard";
import { getProjectionDashboardData } from "@/lib/weeklyProjection";

export const dynamic = "force-dynamic";

export default async function ProjectionsPage() {
  const data = await getProjectionDashboardData();
  const graded = data.history.filter((row) => row.absoluteError !== null);
  const mae = graded.length
    ? graded.reduce((sum, row) => sum + (row.absoluteError ?? 0), 0) / graded.length
    : null;
  const accuracy = graded.length
    ? graded.reduce((sum, row) => sum + (row.accuracyScore ?? 0), 0) / graded.length
    : null;
  const highConfidence = data.current.filter((row) => row.confidence === "HIGH").length;

  return (
    <div className="min-w-0 space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-neutral-100 sm:text-2xl">
          Weekly NFL Projections
        </h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
          Player-level projected NFL stat lines and half-PPR fantasy points. Every
          morning refresh grades completed games, preserves the pregame forecast,
          and uses prior projection error to calibrate later weeks by position.
        </p>
      </section>

      <section>
        <SectionHeader
          title={`${data.season} Week ${data.week}`}
          description="Current projections are regenerated from the latest roster, market context, and nflverse game history. Completed players are never reprojected after their result is known."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricCard
            label="Players projected"
            value={data.current.length.toLocaleString("en-US")}
          />
          <MetricCard
            label="High confidence"
            value={highConfidence.toLocaleString("en-US")}
          />
          <MetricCard
            label="Historical MAE"
            value={mae === null ? "—" : mae.toFixed(2)}
            detail="fantasy points"
          />
          <MetricCard
            label="Mean accuracy"
            value={accuracy === null ? "—" : `${accuracy.toFixed(1)}%`}
            detail={`${graded.length} graded player-weeks`}
          />
        </div>
      </section>

      <WeeklyProjectionBoard
        current={data.current}
        history={data.history}
        season={data.season}
        week={data.week}
      />

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-5 text-neutral-500">
        <div className="font-semibold text-neutral-300">How the projection model learns</div>
        <p className="mt-1">
          The model starts from a position baseline, blends a recency-weighted
          sample of each player&apos;s latest regular-season stat lines with current
          dynasty market role, and applies a position-level correction learned
          from prior graded forecasts. Small samples are regressed more heavily.
          Actual results come from the same nflverse ingestion used elsewhere on
          the dashboard. Accuracy is descriptive model error, not a betting edge.
        </p>
      </section>
    </div>
  );
}
