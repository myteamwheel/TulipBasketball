import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getNflState } from "@/lib/sleeper";
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

  const bundle = await fetchWeeklyProjectionSources(season, week, players);
  const playersWithAnySource = bundle.byPlayer.size;
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
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
