import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getLeague, getNflState } from "@/lib/sleeper";
import { fetchWeeklyProjectionSources } from "@/lib/weeklyProjectionSources";

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

  const [bundle, storedProjectionRows, storedAvailabilityRows, league] = await Promise.all([
    fetchWeeklyProjectionSources(season, week, players),
    prisma.$queryRaw<Array<{ playerId: string }>>`
      SELECT DISTINCT ON ("playerId") "playerId"
      FROM "WeeklyProjection"
      WHERE season = ${season}
        AND week = ${week}
        AND "modelVersion" = 'weekly-consensus-v2.0'
      ORDER BY "playerId", "asOfDate" DESC, "createdAt" DESC
    `,
    prisma.$queryRaw<Array<{ playerId: string; status: string }>>`
      SELECT DISTINCT ON ("playerId") "playerId", status
      FROM "ProjectionAvailability"
      WHERE season = ${season}
        AND week = ${week}
      ORDER BY "playerId", "asOfDate" DESC, "createdAt" DESC
    `,
    getLeague(SLEEPER_LEAGUE_ID).catch(() => null),
  ]);
  const playersWithAnySource = bundle.byPlayer.size;
  const storedProjected = storedProjectionRows.length;
  const storedWithheld = storedAvailabilityRows.filter(
    (row) => row.status === "EXCLUDED",
  ).length;
  const storedClassified = new Set([
    ...storedProjectionRows.map((row) => row.playerId),
    ...storedAvailabilityRows.map((row) => row.playerId),
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
      scoring: league
        ? {
            reception: league.scoring_settings?.rec ?? null,
            passingYard: league.scoring_settings?.pass_yd ?? null,
            passingTd: league.scoring_settings?.pass_td ?? null,
            interception: league.scoring_settings?.pass_int ?? null,
            rushingYard: league.scoring_settings?.rush_yd ?? null,
            rushingTd: league.scoring_settings?.rush_td ?? null,
            receivingYard: league.scoring_settings?.rec_yd ?? null,
            receivingTd: league.scoring_settings?.rec_td ?? null,
            fumbleLost: league.scoring_settings?.fum_lost ?? null,
          }
        : null,
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
