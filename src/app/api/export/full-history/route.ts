import { adminDeniedResponse, isAdminRequest } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { KTC_FORMAT, SLEEPER_LEAGUE_ID } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return adminDeniedResponse();
  const league = await prisma.league.findFirst({ where: { sleeperId: SLEEPER_LEAGUE_ID }, select: { id: true, name: true, season: true, format: true, settings: true, createdAt: true, updatedAt: true } });
  if (!league) return new Response("League not found", { status: 404 });
  const managers = await prisma.manager.findMany({ where: { leagueId: league.id }, orderBy: { sleeperRosterId: "asc" } });
  const managerIds = managers.map((manager) => manager.id);
  const ownershipIntervals = await prisma.ownershipInterval.findMany({ where: { managerId: { in: managerIds } }, orderBy: { validFrom: "asc" } });
  const playerIds = [...new Set(ownershipIntervals.map((row) => row.playerId))];
  const [players, rosterSnapshots, ktcObservations, marketObservations, consensusObservations, transactions, refreshRuns, signals, notes] = await Promise.all([
    prisma.player.findMany({ where: { id: { in: playerIds } }, orderBy: [{ position: "asc" }, { fullName: "asc" }] }),
    prisma.rosterSnapshot.findMany({ where: { managerId: { in: managerIds } }, orderBy: { observedAt: "asc" } }),
    prisma.ktcObservation.findMany({ where: { playerId: { in: playerIds } }, orderBy: [{ observedAt: "asc" }, { playerId: "asc" }] }),
    prisma.marketObservation.findMany({ where: { playerId: { in: playerIds } }, orderBy: [{ observedAt: "asc" }, { playerId: "asc" }, { source: "asc" }] }),
    prisma.consensusObservation.findMany({ where: { playerId: { in: playerIds } }, orderBy: [{ observedAt: "asc" }, { playerId: "asc" }] }),
    prisma.transaction.findMany({ where: { leagueId: league.id }, orderBy: { sleeperCreatedAt: "asc" } }),
    prisma.refreshRun.findMany({ where: { leagueId: league.id }, orderBy: { startedAt: "asc" } }),
    prisma.signal.findMany({ where: { playerId: { in: playerIds } }, orderBy: { createdAt: "asc" } }),
    prisma.userNote.findMany({ where: { playerId: { in: playerIds } }, orderBy: { createdAt: "asc" } }),
  ]);
  const exportedAt = new Date();
  const payload = { exportVersion: 2, exportedAt: exportedAt.toISOString(), product: "Dynasty Boys Market Terminal", ktcFormat: KTC_FORMAT, counts: { managers: managers.length, players: players.length, ownershipIntervals: ownershipIntervals.length, rosterSnapshots: rosterSnapshots.length, ktcObservations: ktcObservations.length, marketObservations: marketObservations.length, consensusObservations: consensusObservations.length, transactions: transactions.length, refreshRuns: refreshRuns.length, signals: signals.length, notes: notes.length }, data: { league, managers, players, ownershipIntervals, rosterSnapshots, ktcObservations, marketObservations, consensusObservations, transactions, refreshRuns, signals, notes } };
  const day = exportedAt.toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="dynasty-boys-full-backup-${day}.json"`, "Cache-Control": "private, no-store, max-age=0" } });
}
