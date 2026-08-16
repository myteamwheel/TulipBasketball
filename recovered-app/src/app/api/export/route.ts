import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function asCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))].join("\n");
}

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "json";
  const league = await prisma.league.findUnique({ where: { sleeperId: SLEEPER_LEAGUE_ID } });
  if (!league) return NextResponse.json({ error: "League not initialized yet" }, { status: 404 });

  const db = prisma as typeof prisma & { draftPickObservation: any };
  const [
    managers, players, ownershipIntervals, refreshRuns, rosterSnapshots,
    ktcObservations, marketObservations, consensusObservations, draftPickObservations,
    transactions, signals, notes,
  ] = await Promise.all([
    prisma.manager.findMany({ where: { leagueId: league.id }, orderBy: { sleeperRosterId: "asc" } }),
    prisma.player.findMany({ orderBy: { fullName: "asc" } }),
    prisma.ownershipInterval.findMany({ orderBy: { validFrom: "asc" } }),
    prisma.refreshRun.findMany({ where: { leagueId: league.id }, orderBy: { startedAt: "asc" } }),
    prisma.rosterSnapshot.findMany({ where: { manager: { leagueId: league.id } }, orderBy: { observedAt: "asc" } }),
    prisma.ktcObservation.findMany({ orderBy: { observedAt: "asc" } }),
    prisma.marketObservation.findMany({ orderBy: { observedAt: "asc" } }),
    prisma.consensusObservation.findMany({ orderBy: { observedAt: "asc" } }),
    db.draftPickObservation.findMany({ orderBy: { observedAt: "asc" } }),
    prisma.transaction.findMany({ where: { leagueId: league.id }, orderBy: { sleeperCreatedAt: "asc" } }),
    prisma.signal.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.userNote.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const playerById = new Map(players.map((p) => [p.id, p]));
  const managerById = new Map(managers.map((m) => [m.id, m]));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (format === "csv") {
    const rows: Record<string, unknown>[] = [];
    for (const o of ktcObservations) {
      const p = playerById.get(o.playerId);
      rows.push({ observed_at: o.observedAt, source: "KTC", player: p?.fullName, sleeper_id: p?.sleeperId, position: p?.position, nfl_team: p?.nflTeam, raw_value: o.value, normalized_value: o.value, validation: o.validationStatus, refresh_run_id: o.refreshRunId, source_type: o.sourceType });
    }
    for (const o of marketObservations) {
      const p = playerById.get(o.playerId);
      rows.push({ observed_at: o.observedAt, source: o.source, player: p?.fullName, sleeper_id: p?.sleeperId, position: p?.position, nfl_team: p?.nflTeam, raw_value: o.rawValue, normalized_value: o.normalizedValue, source_updated_at: o.sourceUpdatedAt, refresh_run_id: o.refreshRunId, source_rank: o.sourceRank, position_rank: o.positionRank });
    }
    for (const o of draftPickObservations) {
      rows.push({ observed_at:o.observedAt, source:"KTC_PICK", player:o.label, position:"PICK", raw_value:o.value, normalized_value:o.value, source_updated_at:o.sourceUpdatedAt, refresh_run_id:o.refreshRunId, pick_season:o.season, pick_round:o.round, pick_bucket:o.bucket });
    }
    for (const o of consensusObservations) {
      const p = playerById.get(o.playerId);
      rows.push({ observed_at: o.observedAt, source: "CONSENSUS", player: p?.fullName, sleeper_id: p?.sleeperId, position: p?.position, nfl_team: p?.nflTeam, raw_value: o.value, normalized_value: o.value, refresh_run_id: o.refreshRunId, source_count: o.sourceCount, sources_used: o.sourcesUsed, weights: o.weights });
    }
    rows.sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)) || String(a.player).localeCompare(String(b.player)));
    const csv = "\uFEFF" + asCsv(rows);
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="dynasty-boys-all-value-history-${stamp}.csv"`, "Cache-Control": "no-store" } });
  }

  const backup = {
    backup_version: 1,
    generated_at: new Date().toISOString(),
    league,
    counts: {
      managers: managers.length, players: players.length, ownership_intervals: ownershipIntervals.length,
      refresh_runs: refreshRuns.length, roster_snapshots: rosterSnapshots.length, ktc_observations: ktcObservations.length,
      market_observations: marketObservations.length, consensus_observations: consensusObservations.length, draft_pick_observations: draftPickObservations.length,
      transactions: transactions.length, signals: signals.length, notes: notes.length,
    },
    data: {
      managers, players, ownership_intervals: ownershipIntervals,
      refresh_runs: refreshRuns, roster_snapshots: rosterSnapshots,
      ktc_observations: ktcObservations, market_observations: marketObservations,
      consensus_observations: consensusObservations, draft_pick_observations: draftPickObservations, transactions, signals, notes,
    },
    lookup_preview: {
      manager_names: Object.fromEntries([...managerById].map(([id, m]) => [id, m.teamName ?? m.displayName])),
      player_names: Object.fromEntries([...playerById].map(([id, p]) => [id, p.fullName])),
    },
  };
  return new NextResponse(JSON.stringify(backup, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="dynasty-boys-complete-backup-${stamp}.json"`, "Cache-Control": "no-store" } });
}
