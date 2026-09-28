import Link from "next/link";
import SectionHeader from "@/components/SectionHeader";
import { getAllCurrentRosterEntries, getAllManagers, getPrimaryManager } from "@/lib/queries";
import { getLatestSlotMap } from "@/lib/teamMetrics";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { getCachedDynastyBoysSimulation } from "@/lib/leagueSimulation";
import { formatDateTimeEastern, formatPoints, formatProbability } from "@/lib/format";
import { POSITION_STARTER_COUNTS } from "@/lib/config";
import { assessPositionOutlook, strategySummary, TEAM_OUTLOOK_POSITIONS, type TeamWindow } from "@/lib/teamOutlook";
import { prisma } from "@/lib/prisma";
import { publicTeamName } from "@/lib/publicIdentity";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Outlook · Dynasty Boys" };

const DEPTH_TARGET: Record<(typeof TEAM_OUTLOOK_POSITIONS)[number], number> = {
  QB: 3,
  RB: 4,
  WR: 5,
  TE: 3,
};
const SLOT_ORDER: Record<string, number> = { STARTER: 0, BENCH: 1, IR: 2, TAXI: 3 };
const veteranAge: Record<string, number> = { QB: 32, RB: 27, WR: 29, TE: 30 };

function windowLabel(window: TeamWindow) {
  if (window === "CONTENDER") return "Contender";
  if (window === "REBUILDER") return "Rebuilder";
  return "Middle of the pack";
}

function ageAt(birthDate: string | null, asOf: Date): number | null {
  if (!birthDate) return null;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;
  return Math.floor((asOf.getTime() - born.getTime()) / (365.2425 * 86400000));
}

export default async function TeamOutlookPage() {
  const [entries, slotMap, simulation, primary, managers] = await Promise.all([
    getAllCurrentRosterEntries(),
    getLatestSlotMap(),
    getCachedDynastyBoysSimulation(),
    getPrimaryManager(),
    getAllManagers(),
  ]);
  const playerIds = [...new Set(entries.map((entry) => entry.playerId))];
  const [marketData, profiles] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    playerIds.length
      ? prisma.$queryRaw<Array<{ playerId: string; birthDate: string | null }>>`SELECT "playerId", "birthDate" FROM "PlayerFootballProfile" WHERE "playerId" = ANY(${playerIds}::text[])`
      : Promise.resolve([]),
  ]);
  const profileByPlayer = new Map(profiles.map((profile) => [profile.playerId, profile]));
  const asOf = simulation.inputRefreshAt ? new Date(simulation.inputRefreshAt) : new Date();
  const entriesByManager = new Map<string, typeof entries>();
  for (const entry of entries) {
    const roster = entriesByManager.get(entry.managerId) ?? [];
    roster.push(entry);
    entriesByManager.set(entry.managerId, roster);
  }
  const managerById = new Map(managers.map((manager) => [manager.id, manager]));
  const simulationByManager = new Map(simulation.rows.map((row) => [row.managerId, row]));
  const managerIds = [...new Set([...managers.map((manager) => manager.id), ...entries.map((entry) => entry.managerId)])];
  const teams = managerIds.map((managerId) => {
    const roster = (entriesByManager.get(managerId) ?? []).map((entry) => {
        const slot = slotMap.get(`${entry.managerId}:${entry.playerId}`) ?? "BENCH";
        const market = marketData.get(entry.playerId);
        const profile = profileByPlayer.get(entry.playerId);
        return {
          entry,
          slot,
          marketValue: market?.currentValue ?? null,
          stale: market?.isStale ?? true,
          age: ageAt(profile?.birthDate ?? null, asOf),
        };
      });
    const manager = roster[0]?.entry.manager;
    const capitalByPosition = new Map<string, number>();
    const activeCountByPosition = new Map<string, number>();
    const marketComparableByPosition = new Map<string, boolean>();
    const freshCount = roster.filter(({ marketValue, stale }) => marketValue !== null && !stale).length;
    for (const position of TEAM_OUTLOOK_POSITIONS) {
      const positional = roster.filter(({ entry, slot }) => entry.player.position === position && slot !== "IR" && slot !== "TAXI");
      activeCountByPosition.set(position, positional.length);
      const values = positional
        .filter(({ marketValue, stale }) => marketValue !== null && !stale)
        .map(({ marketValue }) => marketValue as number)
        .sort((a, b) => b - a)
        .slice(0, POSITION_STARTER_COUNTS[position]);
      capitalByPosition.set(position, values.reduce((sum, value) => sum + value, 0));
      marketComparableByPosition.set(position, values.length >= POSITION_STARTER_COUNTS[position]);
    }
    return {
      managerId,
      name: manager ? publicTeamName(manager) : managerById.has(managerId) ? publicTeamName(managerById.get(managerId)!) : simulationByManager.get(managerId)?.teamName ?? "Unknown team",
      roster,
      freshCount,
      simulation: simulationByManager.get(managerId),
      capitalByPosition,
      activeCountByPosition,
      marketComparableByPosition,
    };
  });

  const positionRanks = new Map<string, { rank: number; comparableTeams: number }>();
  const comparableTeamCounts = new Map<string, number>();
  for (const position of TEAM_OUTLOOK_POSITIONS) {
    const comparable = teams.filter((team) => team.marketComparableByPosition.get(position));
    comparableTeamCounts.set(position, comparable.length);
    // With fewer than half the league comparable, an ordinal rank is too
    // dependent on missing records to support a league-wide need/surplus claim.
    if (comparable.length < Math.ceil(teams.length / 2)) continue;
    const ranked = comparable.sort(
      (a, b) => (b.capitalByPosition.get(position) ?? 0) - (a.capitalByPosition.get(position) ?? 0),
    );
    ranked.forEach((team, index) => positionRanks.set(`${team.managerId}:${position}`, { rank: index + 1, comparableTeams: ranked.length }));
  }
  const coverage = Math.round(simulation.weeklyProjectionCoverage * 100);
  const evidence = Math.round(simulation.evidenceWeight * 100);

  return (
    <div className="min-w-0 space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100 sm:text-2xl">Team Outlook</h1>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
            Playoff and title estimates, each roster&apos;s strongest and thinnest position groups, and a strategy tied to the team&apos;s modeled window.
          </p>
        </div>
        <Link href="/forecast" className="w-fit rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800">Open Predictions →</Link>
      </section>

      <div className={`rounded-lg border p-3 text-sm leading-5 ${coverage < 75 ? "border-amber-900/70 bg-amber-950/20 text-amber-200" : "border-neutral-800 bg-neutral-900 text-neutral-300"}`}>
        <strong>{coverage < 75 ? "Provisional model estimates." : "Current model estimates."}</strong>{" "}
        {simulation.projectionSeason} Week {simulation.projectionWeek} projection coverage is {coverage}%; estimates retain {evidence}% of the simulation&apos;s team-specific signal, with {100 - evidence}% blended toward league-average probabilities. Inputs use the latest completed refresh{simulation.inputRefreshAt ? ` (${formatDateTimeEastern(simulation.inputRefreshAt)})` : ""}{simulation.inputRefreshStatus && simulation.inputRefreshStatus !== "SUCCESS" ? `, which was ${simulation.inputRefreshStatus.toLowerCase().replaceAll("_", " ")}` : ""}. These are model probabilities, not betting odds.
      </div>

      <section className="space-y-3">
        <SectionHeader title="League playoff and title outlook" description="All 12 teams stay visible, including when projection coverage is below the threshold required to publish a validated full-audit snapshot." />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {teams
            .filter((team) => team.simulation)
            .sort((a, b) => (b.simulation?.championshipProbability ?? 0) - (a.simulation?.championshipProbability ?? 0))
            .map((team) => {
              const result = team.simulation!;
              const own = team.managerId === primary?.id;
              return (
                <article key={team.managerId} className={`rounded-lg border p-3 ${own ? "border-emerald-700 bg-emerald-50" : "border-neutral-800 bg-neutral-900"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-neutral-100">{team.name}{own ? <span className="ml-2 text-xs text-emerald-700">Your team</span> : null}</h2>
                      <p className="mt-1 text-xs text-neutral-500">{windowLabel(result.window)} · power rank #{result.powerRank}/12</p>
                    </div>
                    <Link href={`/league/${team.managerId}`} className="text-xs text-emerald-700 underline-offset-2 hover:underline">Roster →</Link>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-md bg-neutral-950 p-2"><div className="text-[11px] text-neutral-500">Playoff chance</div><div className="mt-1 text-lg font-semibold text-neutral-100">{formatProbability(result.playoffProbability)}</div></div>
                    <div className="rounded-md bg-neutral-950 p-2"><div className="text-[11px] text-neutral-500">Title chance</div><div className="mt-1 text-lg font-semibold text-neutral-100">{formatProbability(result.championshipProbability)}</div></div>
                    <div className="rounded-md bg-neutral-950 p-2"><div className="text-[11px] text-neutral-500">Expected wins</div><div className="font-medium text-neutral-100">{result.expectedWins.toFixed(1)}</div></div>
                    <div className="rounded-md bg-neutral-950 p-2"><div className="text-[11px] text-neutral-500">Projected weekly points</div><div className="font-medium text-neutral-100">{result.projectedWeeklyPoints.toFixed(1)}</div></div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-neutral-600">{strategySummary(result.window)}</p>
                </article>
              );
            })}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title="Roster strengths, needs, and surplus" description="Open a team to see its full roster and the evidence behind each position label. This is a decision aid, not an automatic trade instruction." />
        <p className="rounded-md bg-neutral-900 px-3 py-2 text-xs leading-5 text-neutral-500">
          Position need = fewer than the depth target or starter-market capital in the bottom third of comparable teams. Surplus = starter-market capital in the top third plus at least one player above the depth target. Depth targets are QB 3, RB 4, WR 5, TE 3 start-eligible players. Starter capital uses fresh KTC values for the top QB 2 / RB 3 / WR 4 / TE 2 assets. Positions without enough fresh values remain unranked, never treated as zero.
        </p>
        <div className="space-y-3">
          {teams.map((team) => {
            const result = team.simulation;
            const window = result?.window ?? "MIDDLE";
            const assessments = TEAM_OUTLOOK_POSITIONS.map((position) => {
              const rankInfo = positionRanks.get(`${team.managerId}:${position}`);
              const comparableTeams = comparableTeamCounts.get(position) ?? 0;
              const status = assessPositionOutlook({
                position,
                activePlayers: team.activeCountByPosition.get(position) ?? 0,
                targetDepth: DEPTH_TARGET[position],
                starterCapitalRank: rankInfo?.rank ?? null,
                teamCount: rankInfo?.comparableTeams ?? teams.length,
                window,
              });
              return { position, ...status, activeCount: team.activeCountByPosition.get(position) ?? 0, rank: rankInfo?.rank ?? null, comparableTeams, capital: team.capitalByPosition.get(position) ?? 0 };
            });
            const needs = assessments.filter((assessment) => assessment.status === "NEED");
            const surpluses = assessments.filter((assessment) => assessment.status === "SURPLUS");
            const unknowns = assessments.filter((assessment) => assessment.status === "UNKNOWN");
            const sortedRoster = [...team.roster].sort((a, b) => {
              const orderA = TEAM_OUTLOOK_POSITIONS.indexOf(a.entry.player.position as (typeof TEAM_OUTLOOK_POSITIONS)[number]);
              const orderB = TEAM_OUTLOOK_POSITIONS.indexOf(b.entry.player.position as (typeof TEAM_OUTLOOK_POSITIONS)[number]);
              return (orderA < 0 ? 4 : orderA) - (orderB < 0 ? 4 : orderB) || (SLOT_ORDER[a.slot] ?? 4) - (SLOT_ORDER[b.slot] ?? 4) || a.entry.player.fullName.localeCompare(b.entry.player.fullName);
            });
            const own = team.managerId === primary?.id;
            return (
              <details key={team.managerId} className={`group rounded-lg border ${own ? "border-emerald-700 bg-emerald-50" : "border-neutral-800 bg-neutral-900"}`}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden">
                  <span><strong className="text-sm text-neutral-100">{team.name}</strong>{own ? <span className="ml-2 text-xs text-emerald-700">Your team</span> : null}<span className="ml-2 text-xs text-neutral-500">{windowLabel(window)} · {team.roster.length} rostered</span></span>
                  <span className="flex flex-wrap gap-2 text-xs"><span className="rounded bg-rose-50 px-2 py-1 text-rose-800">Needs: {needs.map((item) => item.position).join(", ") || "none flagged"}</span><span className="rounded bg-emerald-50 px-2 py-1 text-emerald-800">Surplus: {surpluses.map((item) => item.position).join(", ") || "none flagged"}</span>{unknowns.length > 0 ? <span className="rounded bg-neutral-200 px-2 py-1 text-neutral-700">Unrated: {unknowns.map((item) => item.position).join(", ")}</span> : null}<span aria-hidden="true" className="text-neutral-500 group-open:rotate-180">⌄</span></span>
                </summary>
                <div className="space-y-4 border-t border-neutral-800 p-3">
                  <p className="text-sm leading-5 text-neutral-600">{strategySummary(window)}</p>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {assessments.map((assessment) => (
                      <div key={assessment.position} className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                        <div className="flex items-center justify-between"><strong className="text-sm text-neutral-100">{assessment.position}</strong><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${assessment.status === "NEED" ? "bg-rose-50 text-rose-800" : assessment.status === "SURPLUS" ? "bg-emerald-50 text-emerald-800" : "bg-neutral-200 text-neutral-700"}`}>{assessment.status === "NEED" ? assessment.priority : assessment.status === "SURPLUS" ? assessment.priority : assessment.status === "UNKNOWN" ? "Market data incomplete" : "Balanced"}</span></div>
                        <p className="mt-2 text-xs text-neutral-500">{assessment.explanation}</p>
                        <p className="mt-1 text-xs text-neutral-500">Fresh starter capital subtotal: {formatPoints(assessment.capital)} · {assessment.rank === null ? `unranked · ${assessment.comparableTeams}/${teams.length} teams meet coverage` : `rank #${assessment.rank}/${assessment.comparableTeams} comparable teams (${assessment.comparableTeams}/${teams.length} coverage)`}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-neutral-200">Full roster · {team.freshCount}/{team.roster.length} fresh market values</h3>
                    <div className="space-y-1.5">
                      {sortedRoster.map(({ entry, slot, marketValue, stale, age }) => {
                        const position = entry.player.position;
                        const old = age !== null && age >= (veteranAge[position] ?? 99);
                        return <div key={entry.playerId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-xs">
                          <div className="min-w-0"><Link href={`/players/${entry.playerId}`} className="font-medium text-neutral-100 hover:underline">{entry.player.fullName}</Link>{entry.player.status && entry.player.status.toLowerCase() !== "active" ? <span className="ml-2 text-amber-800">{entry.player.status}</span> : null}{old ? <span className="ml-2 text-neutral-500">older profile</span> : null}<div className="mt-0.5 truncate text-neutral-500">{position}{entry.player.nflTeam ? ` · ${entry.player.nflTeam}` : ""} · {slot.toLowerCase()}{age === null ? "" : ` · age ${age}`}</div></div>
                          <div className="text-right"><div className="font-medium text-neutral-700">{marketValue === null ? "Unknown" : formatPoints(marketValue)}</div><div className="text-neutral-500">{marketValue === null ? "market value" : stale ? "stale market" : "KTC value"}</div></div>
                        </div>;
                      })}
                    </div>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}
