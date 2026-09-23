import MetricCard from "@/components/MetricCard";
import SectionHeader from "@/components/SectionHeader";
import {
  CurrentProjectionBoard,
  ProjectionAccuracyBoard,
} from "@/components/ProjectionBoard";
import { getProjectionDashboardData } from "@/lib/playerProjections";

export const dynamic = "force-dynamic";

export default async function ProjectionsPage() {
  const data = await getProjectionDashboardData();
  const summary = data.summary;
  const calibratedPositions = new Set(
    data.projections
      .filter((row) => row.calibrationSample >= 5)
      .map((row) => row.position),
  );

  return (
    <div className="min-w-0 space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-neutral-100 sm:text-2xl">
          Projected Points
        </h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
          Week {data.week} real-life stat-line forecasts for every rostered QB,
          RB, WR, and TE, converted into fantasy points using the league&apos;s
          current Sleeper scoring settings where the modeled box-score fields
          apply.
        </p>
      </section>

      <section>
        <SectionHeader
          title={`Week ${data.week} forecast · ${data.season}`}
          description="Current-season production gets the most weight, recent games matter more than older games, and thin samples are regressed toward same-position league baselines."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricCard
            label="Players projected"
            value={data.projections.length.toLocaleString("en-US")}
            detail="current league rosters"
          />
          <MetricCard
            label="Evaluated forecasts"
            value={summary.evaluated.toLocaleString("en-US")}
            detail="pregame snapshots with actuals"
          />
          <MetricCard
            label="Fantasy MAE"
            value={summary.mae === null ? "—" : summary.mae.toFixed(1)}
            detail="mean absolute points error"
          />
          <MetricCard
            label="Within 5 pts"
            value={summary.within5 === null ? "—" : `${summary.within5.toFixed(1)}%`}
            detail={
              calibratedPositions.size
                ? `feedback active: ${[...calibratedPositions].join(", ")}`
                : "feedback begins after enough graded forecasts"
            }
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Player projections"
          description="Sort by projected points, recent production, evidence sample, or player. Bye/inactive players are explicitly zeroed instead of receiving a generic fallback."
        />
        <CurrentProjectionBoard rows={data.projections} />
      </section>

      <section>
        <SectionHeader
          title="Projection accuracy"
          description="Each completed game is matched to the latest saved pregame forecast. Sort by closest projection, largest miss, week, projected points, or actual points."
        />
        {summary.evaluated > 0 ? (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <MetricCard label="Evaluated" value={summary.evaluated.toString()} />
            <MetricCard
              label="MAE"
              value={summary.mae?.toFixed(1) ?? "—"}
              detail="lower is better"
            />
            <MetricCard
              label="RMSE"
              value={summary.rmse?.toFixed(1) ?? "—"}
              detail="penalizes large misses"
            />
            <MetricCard
              label="Mean bias"
              value={
                summary.bias === null
                  ? "—"
                  : `${summary.bias > 0 ? "+" : ""}${summary.bias.toFixed(1)}`
              }
              detail="+ means model projected too high"
            />
            <MetricCard
              label="Within 3 pts"
              value={
                summary.within3 === null
                  ? "—"
                  : `${summary.within3.toFixed(1)}%`
              }
            />
          </div>
        ) : null}
        <ProjectionAccuracyBoard rows={data.accuracy} />
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-[10px] leading-5 text-neutral-500">
        <div className="font-semibold text-neutral-300">
          How the weekly model learns
        </div>
        <p className="mt-1">
          The daily refresh saves a new pregame snapshot before actual results
          exist. After games are ingested, the site grades that saved forecast
          against the real NFL box score. Current-season games automatically
          receive the greatest weight in the next forecast. Once a position has
          at least five graded forecasts, the engine also applies a capped
          position-level bias correction from its own prior misses. It never
          backfills a pretend prediction for a game that was already played.
        </p>
        <p className="mt-2">
          The stat model covers passing, rushing, receiving, interceptions and
          lost fumbles. Exotic threshold/bonus scoring that cannot be inferred
          from a single expected stat line is not projected as guaranteed
          points. Forecasts are estimates, not sportsbook lines.
        </p>
      </section>
    </div>
  );
}
