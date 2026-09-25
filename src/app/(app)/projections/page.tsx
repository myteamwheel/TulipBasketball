import MetricCard from "@/components/MetricCard";
import SectionHeader from "@/components/SectionHeader";
import WeeklyProjectionBoard from "@/components/WeeklyProjectionBoard";
import { getLeague } from "@/lib/sleeper";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { unsupportedNonzeroScoring } from "@/lib/fantasyScoring";
import { getProjectionDashboardData } from "@/lib/weeklyProjection";

export const dynamic = "force-dynamic";

export default async function ProjectionsPage() {
  const [data, league] = await Promise.all([getProjectionDashboardData(), getLeague(SLEEPER_LEAGUE_ID)]);
  const omittedScoring = unsupportedNonzeroScoring(league.scoring_settings);
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
          Player-level projected NFL stat lines and half-PPR fantasy points.
          Weekly role must be supported by current external projection data, and
          the displayed stat line is a concrete whole-number outcome. Every
          refresh preserves the pregame forecast and grades it against actual NFL
          results so later weeks can be recalibrated.
        </p>
      </section>

      <section>
        <SectionHeader
          title={`${data.season} Week ${data.week}`}
          description="Every row shows the Sleeper and CBS player projections, the local recency model, their player-level blend, DraftKings game-market context through ESPN, and the final scoring-adjusted fantasy projection. Game odds are a bounded team-environment adjustment, not an invented individual player projection."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <MetricCard
            label="Players projected"
            value={data.current.length.toLocaleString("en-US")}
          />
          <MetricCard
            label="Withheld"
            value={data.unavailable.length.toLocaleString("en-US")}
            detail="inactive / no supported role / already played"
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
        unavailable={data.unavailable}
        season={data.season}
        week={data.week}
      />

      {omittedScoring.length > 0 && <details className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs leading-5 text-neutral-500"><summary className="cursor-pointer font-medium text-neutral-300">Scoring coverage note</summary><p className="mt-1">Final points use the league’s core scoring. {omittedScoring.length} bonus or uncommon event type{omittedScoring.length === 1 ? " is" : "s are"} not projected by the source feeds, so the visible stat line and accuracy grade cover the core scoring events.</p></details>}

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-5 text-neutral-500">
        <div className="font-semibold text-neutral-300">How the projection model learns</div>
        <p className="mt-1">
          Sleeper and CBS weekly projections establish current playing-time and
          role expectations. DraftKings game totals and spreads, supplied through
          ESPN, make a bounded team-environment adjustment. Those inputs are
          blended with a recency-weighted local NFL stat model and then adjusted
          by position-level error learned from prior graded forecasts. Final
          fantasy points remain the unrounded model output; the visible stat line
          is rounded separately into whole-number football events for readability.
          Actual results come from nflverse. Accuracy is descriptive model error,
          not a betting edge.
        </p>
      </section>
    </div>
  );
}
