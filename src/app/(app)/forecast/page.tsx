import Link from "next/link";
import SectionHeader from "@/components/SectionHeader";
import PredictiveBoard from "@/components/PredictiveBoard";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import {
  getDecisionGradePredictiveModels as getPredictivePlayerModels,
  isDecisionGradeProductionSeason,
} from "@/lib/predictiveSafety";
import { formatPoints } from "@/lib/format";
import { getProjectionDashboardData } from "@/lib/weeklyProjection";
export const dynamic = "force-dynamic";
export default async function ForecastPage() {
  const entries = await getAllCurrentRosterEntries();
  const ids = entries.map((e) => e.playerId),
    [models, projectionData] = await Promise.all([
      getPredictivePlayerModels(ids),
      getProjectionDashboardData(),
    ]),
    weeklyProjectionByPlayer = new Map(
      projectionData.current.map((row) => [
        row.playerId,
        row.projectedFantasyPoints,
      ]),
    ),
    weeklyWithheld = new Set(
      projectionData.unavailable
        .filter((row) => row.status === "EXCLUDED")
        .map((row) => row.playerId),
    ),
    rows = [...models.values()],
    liveWeeklyRows = rows.filter(
      (row) =>
        weeklyProjectionByPlayer.has(row.playerId) &&
        !weeklyWithheld.has(row.playerId),
    ),
    modelGaps = liveWeeklyRows
      .filter(
        (r) =>
          r.currentValue >= 1000 &&
          r.confidence !== "LOW" &&
          isDecisionGradeProductionSeason(r.latestSeason, r.games),
      )
      .sort(
        (a, b) =>
          Math.abs(b.modelEdge) - Math.abs(a.modelEdge) ||
          Math.abs(b.modelEdgePercent) - Math.abs(a.modelEdgePercent),
      )
      .slice(0, 8),
    productionLeaders = liveWeeklyRows
      .filter(
        (r) =>
          r.confidence !== "LOW" &&
          r.fantasyPpg !== null &&
          isDecisionGradeProductionSeason(r.latestSeason, r.games),
      )
      .sort((a, b) => (b.fantasyPpg ?? 0) - (a.fantasyPpg ?? 0))
      .slice(0, 6),
    productionCovered = rows.filter((r) =>
      isDecisionGradeProductionSeason(r.latestSeason, r.games),
    ).length,
    rosteredSkillPlayers = entries.filter((entry) =>
      ["QB", "RB", "WR", "TE"].includes(entry.player.position),
    ),
    completedCurrentWeek = new Set(
      projectionData.history
        .filter(
          (row) =>
            row.season === projectionData.season &&
            row.week === projectionData.week &&
            row.actualFantasyPoints !== null,
        )
        .map((row) => row.playerId),
    ),
    classifiedCurrentWeek = new Set([
      ...projectionData.current.map((row) => row.playerId),
      ...projectionData.unavailable.map((row) => row.playerId),
      ...completedCurrentWeek,
    ]),
    weeklyCoverage = rosteredSkillPlayers.length
      ? classifiedCurrentWeek.size / rosteredSkillPlayers.length
      : 0,
    weeklyFallback = [...projectionData.current]
      .sort((a, b) => b.projectedFantasyPoints - a.projectedFantasyPoints)
      .slice(0, 6);
  return (
    <div className="min-w-0 space-y-6">
      <section>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-100 sm:text-2xl">
              Prediction Center
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
              Player research for weekly decisions and dynasty value. Open a
              player to see the evidence behind the model.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/projections"
              className="w-fit rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300"
            >
              Weekly projections →
            </Link>
            <Link
              href="/team-outlook"
              className="w-fit rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300"
            >
              Team Outlook →
            </Link>
            <Link
              href="/team-outlook/trade-impact"
              className="w-fit rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300"
            >
              Trade impact →
            </Link>
          </div>
        </div>
      </section>
      <p className="text-xs text-neutral-400">Usable current or prior-season production: {productionCovered}/{rows.length} valued players. A live weekly role is also required for actionable model edges.</p>
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <SectionHeader
          title="This week’s usable signal"
          description={
            weeklyCoverage >= 0.75
              ? `Current-role coverage is ${(weeklyCoverage * 100).toFixed(0)}% across rostered skill players.`
              : `Current-role coverage is ${(weeklyCoverage * 100).toFixed(0)}% across rostered skill players, below the threshold for a fully validated weekly team forecast.`
          }
        />
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="rounded-md bg-neutral-950 p-2.5">
            <div className="text-[9px] uppercase tracking-wide text-neutral-600">Role-supported</div>
            <div className="mt-1 text-lg font-semibold text-emerald-300">{projectionData.current.length}</div>
          </div>
          <div className="rounded-md bg-neutral-950 p-2.5">
            <div className="text-[9px] uppercase tracking-wide text-neutral-600">Withheld with reason</div>
            <div className="mt-1 text-lg font-semibold text-amber-300">{projectionData.unavailable.length}</div>
          </div>
          <div className="rounded-md bg-neutral-950 p-2.5">
            <div className="text-[9px] uppercase tracking-wide text-neutral-600">Completed</div>
            <div className="mt-1 text-lg font-semibold text-sky-300">{completedCurrentWeek.size}</div>
          </div>
          <div className="rounded-md bg-neutral-950 p-2.5">
            <div className="text-[9px] uppercase tracking-wide text-neutral-600">Classified coverage</div>
            <div className={`mt-1 text-lg font-semibold ${weeklyCoverage >= 0.75 ? "text-emerald-300" : "text-amber-300"}`}>{(weeklyCoverage * 100).toFixed(0)}%</div>
          </div>
        </div>
        {weeklyCoverage < 0.75 ? (
          <p className="mt-3 text-[11px] leading-5 text-amber-200">
            The role-supported rows below are usable for player-level lineup decisions. Players without a verified role, completed games, or an identity check are held out rather than filled with estimates. Team Outlook keeps its league probabilities provisional until coverage reaches 75%; the daily audit does not publish a new weekly forecast as fully validated before then.
          </p>
        ) : null}
        {weeklyFallback.length ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {weeklyFallback.map((row) => (
              <Link
                key={row.playerId}
                href={`/players/${row.playerId}`}
                className="rounded-md border border-neutral-800 bg-neutral-950 p-2 text-xs text-neutral-300 hover:border-emerald-900"
              >
                <span className="font-medium text-neutral-100">{row.playerName}</span>
                <span className="ml-1 text-neutral-600">{row.position}{row.nflTeam ? ` · ${row.nflTeam}` : ""}</span>
                <span className="float-right font-semibold text-emerald-300">{row.projectedFantasyPoints.toFixed(1)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-amber-200">No role-supported weekly rows are available from the current feeds, so no team-level weekly output is presented as usable.</p>
        )}
      </section>
      {productionCovered < rows.length * 0.6 ? (
        <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-[11px] leading-5 text-amber-200">
          Football-model coverage is still ramping: {productionCovered}/
          {rows.length} valued league players currently have decision-grade
          recent regular-season production (current or immediately prior season)
          in the local model. Older seasons remain historical context but do not
          count as current predictive evidence. Missing profile/production data
          is treated as unknown—not negative evidence—and low-confidence
          probability outputs are withheld.
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <SectionHeader
            title="Largest live-role model disagreements"
            description="Decision-grade review flags where recent football evidence and the current dynasty market disagree most among players with a current role-supported weekly projection. These are not automatic buy or sell signals."
          />
          <div className="space-y-2">
            {modelGaps.length ? (
              modelGaps.map((r) => (
                <Link
                  key={r.playerId}
                  href={`/players/${r.playerId}`}
                  className="grid grid-cols-[1fr_auto] gap-3 rounded-md bg-neutral-950 p-2.5"
                >
                  <div>
                    <div className="text-xs font-medium text-neutral-100">
                      {r.fullName}
                    </div>
                    <div className="text-[9px] text-neutral-600">
                      {r.position} · KTC {formatPoints(r.currentValue)} · model{" "}
                      {formatPoints(r.modelValue)} · {r.games} recent games
                    </div>
                  </div>
                  <div
                    className={`text-right text-sm font-semibold ${r.modelEdgePercent >= 0 ? "text-emerald-300" : "text-red-300"}`}
                  >
                    {r.modelEdgePercent >= 0 ? "+" : ""}
                    {r.modelEdgePercent.toFixed(1)}%
                  </div>
                </Link>
              ))
            ) : (
              <div className="text-xs text-neutral-600">
                No decision-grade market/model disagreements yet.
              </div>
            )}
          </div>
        </section>
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <SectionHeader
            title="Recent production leaders with live weekly roles"
            description="The strongest recent regular-season fantasy production among players with a decision-grade sample and a current role-supported weekly projection. This is descriptive football evidence, not a dynasty ranking."
          />
          <div className="space-y-2">
            {productionLeaders.length ? (
              productionLeaders.map((r) => (
                <Link
                  key={r.playerId}
                  href={`/players/${r.playerId}`}
                  className="block rounded-md bg-neutral-950 p-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-neutral-100">
                      {r.fullName}
                    </div>
                    <div className="text-sm font-semibold text-neutral-100">
                      {r.fantasyPpg?.toFixed(1)} PPG
                    </div>
                  </div>
                  <div className="mt-1 text-[9px] text-neutral-600">
                    {r.position} · {r.games} games ·{" "}
                    {r.opportunityPerGame === null
                      ? "opportunity unavailable"
                      : `${r.opportunityPerGame.toFixed(1)} opportunities/game`} ·{" "}
                    {`${weeklyProjectionByPlayer.get(r.playerId)?.toFixed(1)} consensus weekly pts`}
                  </div>
                </Link>
              ))
            ) : (
              <div className="text-xs text-neutral-600">
                No decision-grade recent production sample yet.
              </div>
            )}
          </div>
        </section>
      </div>
      <section>
        <SectionHeader
          title="Predictive player board"
          description="An evidence-first dynasty board. KTC and trusted market values stay visible beside recent NFL production, opportunity, model fair value and weekly role. Missing football data remains unknown rather than negative evidence."
        />
        <PredictiveBoard rows={rows} />
      </section>
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-5 text-neutral-500">
        <div className="font-semibold text-neutral-300">
          How to read the dynasty model
        </div>
        <p className="mt-1">
          When usable football/profile evidence exists, independent value scores
          production, opportunity/usage, efficiency, age curve and draft capital
          against positional peers, then maps that evidence onto the current
          positional dynasty-value distribution. When those inputs are missing,
          the independent component is neutral instead of assuming weak draft
          capital. “Model value” then blends the evidence-gated result with KTC
          and the fresh trusted secondary market. Forecast ranges remain
          scenario estimates and widen for volatile or low-data players.
        </p>
      </section>
    </div>
  );
}
