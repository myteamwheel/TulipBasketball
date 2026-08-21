import Link from "next/link";
import MetricCard from "@/components/MetricCard";
import SectionHeader from "@/components/SectionHeader";
import PredictiveBoard from "@/components/PredictiveBoard";
import PredictiveTradeImpact, {
  type PredictiveTradeAsset,
} from "@/components/PredictiveTradeImpact";
import {
  getAllCurrentRosterEntries,
  getAllManagers,
  getPrimaryManager,
} from "@/lib/queries";
import {
  getDecisionGradePredictiveModels as getPredictivePlayerModels,
  isDecisionGradeProductionSeason,
} from "@/lib/predictiveSafety";
import { predictiveQuadrantLabel } from "@/lib/predictive";
import { simulateDynastyBoys } from "@/lib/leagueSimulation";
import { computeAllTeamValuations, getLatestSlotMap } from "@/lib/teamMetrics";
import { publicTeamName } from "@/lib/publicIdentity";
import { formatPoints, formatProbability } from "@/lib/format";
export const dynamic = "force-dynamic";
export default async function ForecastPage() {
  const [entries, managers, primary, valuations, slotMap] = await Promise.all([
    getAllCurrentRosterEntries(),
    getAllManagers(),
    getPrimaryManager(),
    computeAllTeamValuations(),
    getLatestSlotMap(),
  ]);
  if (!primary)
    return (
      <div className="text-sm text-neutral-500">Primary team unavailable.</div>
    );
  const ids = entries.map((e) => e.playerId),
    [models, simulation] = await Promise.all([
      getPredictivePlayerModels(ids),
      simulateDynastyBoys(2500),
    ]),
    rows = [...models.values()],
    mySim = simulation.rows.find((r) => r.managerId === primary.id),
    managerById = new Map(managers.map((m) => [m.id, m])),
    undervalued = rows
      .filter((r) => r.currentValue >= 1000 && r.confidence !== "LOW")
      .sort((a, b) => b.modelEdgePercent - a.modelEdgePercent)
      .slice(0, 8),
    footballLeads = rows
      .filter(
        (r) =>
          (r.mispricingQuadrant === "FOOTBALL_LEADS" ||
            r.mispricingQuadrant === "BOTH_UP") &&
          r.confidence !== "LOW",
      )
      .sort((a, b) => b.modelEdgePercent - a.modelEdgePercent)
      .slice(0, 6),
    productionCovered = rows.filter((r) =>
      isDecisionGradeProductionSeason(r.latestSeason, r.games),
    ).length,
    assets: PredictiveTradeAsset[] = [];
  for (const entry of entries) {
    const model = models.get(entry.playerId);
    if (!model) continue;
    assets.push({
      id: entry.playerId,
      assetType: "player",
      managerId: entry.managerId,
      managerName: publicTeamName(entry.manager),
      name: entry.player.fullName,
      position: entry.player.position,
      marketValue: model.currentValue,
      modelValue: model.modelValue,
      forecast1y: model.forecast1y.mean,
      projectedPpg: model.projectedWeeklyPoints,
      slot: slotMap.get(`${entry.managerId}:${entry.playerId}`) ?? "BENCH",
    });
  }
  for (const valuation of valuations) {
    for (const pick of valuation.draftPicks) {
      assets.push({
        id: pick.id,
        assetType: "pick",
        managerId: valuation.managerId,
        managerName: valuation.teamName,
        name: pick.label,
        position: "PICK",
        marketValue: pick.value,
        modelValue: pick.value,
        forecast1y: pick.value,
        projectedPpg: 0,
        slot: "PICK",
      });
    }
  }
  return (
    <div className="min-w-0 space-y-6">
      <section>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-100 sm:text-2xl">
              Prediction Center
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
              Market value answers what dynasty players believe today. This
              layer asks what the underlying football, age curve, draft capital,
              opportunity and league context imply next.
            </p>
          </div>
          <Link
            href="/trade-finder"
            className="w-fit rounded-md border border-emerald-800 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-300"
          >
            Open Trade Lab →
          </Link>
        </div>
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
      <section>
        <SectionHeader
          title="Orlando forecast"
          description={`League simulation · ${simulation.iterations.toLocaleString("en-US")} seasons · ${simulation.scheduleSource === "SLEEPER" ? "Sleeper schedule" : "balanced fallback schedule"}.`}
        />
        {mySim ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <MetricCard
              label="Weekly projection"
              value={mySim.projectedWeeklyPoints.toFixed(1)}
              detail={`power #${mySim.powerRank}/12`}
            />
            <MetricCard
              label="Expected wins"
              value={mySim.expectedWins.toFixed(1)}
              detail={`expected seed ${mySim.expectedSeed.toFixed(1)}`}
            />
            <MetricCard
              label="Playoff odds"
              value={formatProbability(mySim.playoffProbability)}
            />
            <MetricCard
              label="Title odds"
              value={formatProbability(mySim.championshipProbability)}
            />
            <MetricCard
              label="Model capital"
              value={formatPoints(mySim.modelCapital)}
              detail={`market ${formatPoints(mySim.marketCapital)}`}
            />
            <MetricCard
              label="Team window"
              value={mySim.window}
              detail={`${simulation.completedWeeks} completed weeks in model`}
            />
          </div>
        ) : null}
        <p className="mt-2 text-[9px] leading-4 text-neutral-600">
          Simulation probabilities are model outputs, not betting probabilities.
          When recent production coverage is sparse, win/seed/playoff/title
          estimates are conservatively shrunk toward league-neutral priors
          instead of presenting market-implied lineup projections as precise
          probabilities. Current player projections blend recent half-PPR
          production with market-implied role where evidence is current enough;
          stale seasons fall back to market-implied role rather than carrying
          old PPG forward.
        </p>
      </section>
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
        <SectionHeader
          title="Dynasty Boys title race"
          description="Projected start-eligible weekly points drive game simulation; completed Sleeper results are retained when the regular season is underway."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <caption className="sr-only">
              Simulated weekly scoring, expected wins, playoff odds, and title
              odds for every Dynasty Boys team
            </caption>
            <thead>
              <tr className="text-[9px] uppercase tracking-wide text-neutral-600">
                <th className="pb-2 text-left">Team</th>
                <th className="pb-2 text-right">Power</th>
                <th className="pb-2 text-right">Proj PPG</th>
                <th className="pb-2 text-right">Exp wins</th>
                <th className="pb-2 text-right">Playoffs</th>
                <th className="pb-2 text-right">Title</th>
                <th className="pb-2 text-right">Window</th>
              </tr>
            </thead>
            <tbody>
              {simulation.rows.map((team) => (
                <tr
                  key={team.managerId}
                  className="border-t border-neutral-800"
                >
                  <td className="py-2 text-neutral-200">{team.teamName}</td>
                  <td className="py-2 text-right text-neutral-500">
                    #{team.powerRank}
                  </td>
                  <td className="py-2 text-right text-neutral-300">
                    {team.projectedWeeklyPoints.toFixed(1)}
                  </td>
                  <td className="py-2 text-right text-neutral-300">
                    {team.expectedWins.toFixed(1)}
                  </td>
                  <td className="py-2 text-right text-neutral-300">
                    {formatProbability(team.playoffProbability)}
                  </td>
                  <td className="py-2 text-right font-medium text-emerald-300">
                    {formatProbability(team.championshipProbability)}
                  </td>
                  <td className="py-2 text-right text-neutral-500">
                    {team.window}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <SectionHeader
            title="Largest model discounts"
            description="Players where evidence-gated model fair value sits furthest above current KTC, excluding low-confidence rows."
          />
          <div className="space-y-2">
            {undervalued.map((r) => (
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
                    {formatPoints(r.modelValue)}
                  </div>
                </div>
                <div className="text-right text-sm font-semibold text-emerald-300">
                  +{r.modelEdgePercent.toFixed(1)}%
                </div>
              </Link>
            ))}
          </div>
        </section>
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <SectionHeader
            title="Market vs football"
            description="The most interesting mispricing state: underlying football inputs lead while market value has not fully followed. Low-confidence peer samples are excluded."
          />
          <div className="space-y-2">
            {footballLeads.length ? (
              footballLeads.map((r) => (
                <Link
                  key={r.playerId}
                  href={`/players/${r.playerId}`}
                  className="block rounded-md bg-neutral-950 p-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-neutral-100">
                      {r.fullName}
                    </div>
                    <div className="text-[10px] text-emerald-300">
                      {r.modelEdgePercent >= 0 ? "+" : ""}
                      {r.modelEdgePercent.toFixed(1)}%
                    </div>
                  </div>
                  <div className="mt-1 text-[9px] text-neutral-600">
                    {predictiveQuadrantLabel(r.mispricingQuadrant)} · usage pctl{" "}
                    {Math.round(r.usageScore * 100)} ·{" "}
                    {r.forecast1y.mean.toLocaleString("en-US")} 1y mean
                  </div>
                </Link>
              ))
            ) : (
              <div className="text-xs text-neutral-600">
                No decision-grade football-leading mispricing yet.
              </div>
            )}
          </div>
        </section>
      </div>
      <section>
        <SectionHeader
          title="Predictive player board"
          description="TDV/model fair value blends current market data with independent football evidence only when that evidence exists. Missing player profiles are neutral rather than penalized; low-confidence probabilities are withheld until coverage improves."
        />
        <PredictiveBoard rows={rows} />
      </section>
      <section>
        <PredictiveTradeImpact
          assets={assets}
          context={simulation.context}
          primaryManagerId={primary.id}
          primaryManagerName={publicTeamName(
            managerById.get(primary.id) ?? primary,
          )}
          baselinePlayoff={mySim?.playoffProbability ?? 0}
          baselineTitle={mySim?.championshipProbability ?? 0}
          evidenceWeight={simulation.evidenceWeight}
        />
      </section>
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-5 text-neutral-500">
        <div className="font-semibold text-neutral-300">
          How to read this model
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
