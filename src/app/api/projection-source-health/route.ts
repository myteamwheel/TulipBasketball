import { getProjectionDashboardData } from "@/lib/weeklyProjection";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getLeague, getNflState } from "@/lib/sleeper";
import { fetchWeeklyProjectionSources } from "@/lib/weeklyProjectionSources";
import {
  scoringFromSleeperSettings,
  unsupportedNonzeroScoring,
} from "@/lib/fantasyScoring";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getNflState().catch(() => null);
  const season = Number(state?.season ?? new Date().getUTCFullYear());
  const week = Math.max(1, Number(state?.week ?? 1));

  const players = await prisma.$queryRaw<
    Array<{
      sleeperId: string;
      fullName: string;
      position: string;
      nflTeam: string | null;
    }>
  >`
    SELECT DISTINCT
      p."sleeperId",
      p."fullName",
      p.position,
      p."nflTeam"
    FROM "Player" p
    JOIN "OwnershipInterval" oi
      ON oi."playerId" = p.id
     AND oi."validTo" IS NULL
    JOIN "Manager" m
      ON m.id = oi."managerId"
     AND m."isActive" = true
    JOIN "League" l
      ON l.id = m."leagueId"
    WHERE l."sleeperId" = ${SLEEPER_LEAGUE_ID}
      AND p.position IN ('QB','RB','WR','TE')
  `;

  const league = await getLeague(SLEEPER_LEAGUE_ID).catch(() => null);
  const scoring = scoringFromSleeperSettings(league?.scoring_settings);
  const [bundle, stored] = await Promise.all([
    fetchWeeklyProjectionSources(season, week, players, scoring),
    getProjectionDashboardData(),
  ]);
  const playersWithAnySource = bundle.byPlayer.size;
  const storedProjected = stored.current.length;
  const storedWithheld = stored.unavailable.filter(
    (row) => row.status === "EXCLUDED",
  ).length;
  const storedClassified = new Set([
    ...stored.current.map((row) => row.playerId),
    ...stored.unavailable.map((row) => row.playerId),
  ]).size;
  const sourceCoverage = Object.fromEntries(
    bundle.statuses.map((status) => [
      status.source,
      {
        ok: status.ok,
        rows: status.rows,
        message: status.message,
      },
    ]),
  );

  return NextResponse.json(
    {
      season,
      week,
      rosteredSkillPlayers: players.length,
      playersWithAnySource,
      anySourceCoverage:
        players.length > 0 ? playersWithAnySource / players.length : 0,
      sources: sourceCoverage,
      scoring,
      unsupportedNonzeroScoring: unsupportedNonzeroScoring(
        league?.scoring_settings,
      ),
      stored: {
        projected: storedProjected,
        withheld: storedWithheld,
        classified: storedClassified,
        classificationCoverage:
          players.length > 0 ? storedClassified / players.length : 0,
      },
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
