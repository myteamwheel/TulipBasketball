import { adminDeniedResponse, isAdminRequest } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
function csv(value: unknown): string { if (value == null) return ""; const text = value instanceof Date ? value.toISOString() : String(value); return `"${text.replace(/"/g, '""')}"`; }

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return adminDeniedResponse();
  const playerIds = (await prisma.ownershipInterval.findMany({ where: { manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } }, select: { playerId: true } })).map((row) => row.playerId);
  const rows = await prisma.ktcObservation.findMany({ where: { playerId: { in: [...new Set(playerIds)] } }, include: { player: { select: { fullName: true, position: true, nflTeam: true, sleeperId: true, ktcId: true } } }, orderBy: [{ observedAt: "asc" }, { playerId: "asc" }] });
  const header = ["observed_at","player","position","nfl_team","value","validation_status","source_type","source_url","format","refresh_run_id","import_batch_id","sleeper_id","ktc_id","validation_note","created_at"];
  const lines = [header.map(csv).join(",")];
  for (const row of rows) lines.push([row.observedAt,row.player.fullName,row.player.position,row.player.nflTeam,row.value,row.validationStatus,row.sourceType,row.sourceUrl,row.format,row.refreshRunId,row.importBatchId,row.player.sleeperId,row.player.ktcId,row.validationNote,row.createdAt].map(csv).join(","));
  const day = new Date().toISOString().slice(0,10);
  return new Response(`\uFEFF${lines.join("\r\n")}`, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="dynasty-boys-ktc-history-${day}.csv"`, "Cache-Control": "private, no-store, max-age=0" } });
}
