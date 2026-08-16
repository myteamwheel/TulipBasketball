import { isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KTC_FORMAT, SLEEPER_LEAGUE_ID } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await isAuthenticated())) return new Response("Unauthorized", { status: 401 });

  const [
    league,
    managers,
    players,
    ownershipIntervals,
    rosterSnapshots,
    ktcObservations,
    marketObservations,
    consensusObservations,
    transactions,
    refreshRuns,
    signals,
    notes,
  ] = await Promise.all([
    prisma.league.findFirst({ where: { sleeperId: SLEEPER_LEAGUE_ID } }),
    prisma.manager.findMany({ where: { league: { sleeperId: SLEEPER_LEAGUE_ID } }, orderBy: { sleeperRosterId: "asc" } }),
    prisma.player.findMany({ orderBy: [{ position: "asc" }, { fullName: "asc" }] }),
    prisma.ownershipInterval.findMany({ where: { manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } }, orderBy: { validFrom: "asc" } }),
    prisma.rosterSnapshot.findMany({ where: { manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } }, orderBy: { observedAt: "asc" } }),
    prisma.ktcObservation.findMany({ orderBy: [{ observedAt: "asc" }, { playerId: "asc" }] }),
    prisma.marketObservation.findMany({ orderBy: [{ observedAt: "asc" }, { playerId: "asc" }, { source: "asc" }] }),
    prisma.consensusObservation.findMany({ orderBy: [{ observedAt: "asc" }, { playerId: "asc" }] }),
    prisma.transaction.findMany({ where: { league: { sleeperId: SLEEPER_LEAGUE_ID } }, orderBy: { sleeperCreatedAt: "asc" } }),
    prisma.refreshRun.findMany({ where: { league: { sleeperId: SLEEPER_LEAGUE_ID } }, orderBy: { startedAt: "asc" } }),
    prisma.signal.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.userNote.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const exportedAt = new Date();
  const payload = {
    exportVersion: 1,
    exportedAt: exportedAt.toISOString(),
    product: "Dynasty Boys Market Terminal",
    sleeperLeagueId: SLEEPER_LEAGUE_ID,
    ktcFormat: KTC_FORMAT,
    purpose: "Full-fidelity manual backup of stored dashboard data. Historical observation rows are included verbatim so the export can be audited or migrated later.",
    counts: {
      managers: managers.length,
      players: players.length,
      ownershipIntervals: ownershipIntervals.length,
      rosterSnapshots: rosterSnapshots.length,
      ktcObservations: ktcObservations.length,
      marketObservations: marketObservations.length,
      consensusObservations: consensusObservations.length,
      transactions: transactions.length,
      refreshRuns: refreshRuns.length,
      signals: signals.length,
      notes: notes.length,
    },
    data: {
      league,
      managers,
      players,
      ownershipIntervals,
      rosterSnapshots,
      ktcObservations,
      marketObservations,
      consensusObservations,
      transactions,
      refreshRuns,
      signals,
      notes,
    },
  };

  const day = exportedAt.toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dynasty-boys-full-backup-${day}.json"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
