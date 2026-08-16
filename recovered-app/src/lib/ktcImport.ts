// KTC snapshot parser/persistence. This is the single append-only persistence path used by manual imports, optional feeds, and the live public-page collector.
import Papa from "papaparse";
import { prisma } from "@/lib/prisma";
import { normalizePlayerName } from "@/lib/normalize";
import { KTC_FORMAT } from "@/lib/config";

export interface KtcImportRow {
  name: string;
  position?: string;
  team?: string;
  value: number;
  ktcId?: string;
  rank?: number;
}

export interface KtcImportRowResult {
  row: KtcImportRow;
  outcome: "committed" | "flagged" | "rejected" | "unmatched" | "ambiguous" | "duplicate";
  detail: string;
  playerId?: string;
}

export interface KtcImportSummary {
  importBatchId: string;
  totalRows: number;
  committed: number;
  flagged: number;
  rejected: number;
  unmatched: number;
  ambiguous: number;
  skippedDuplicates: number;
  results: KtcImportRowResult[];
}

const FIELD_ALIASES: Record<string, keyof KtcImportRow> = {
  name: "name",
  player: "name",
  player_name: "name",
  playername: "name",
  position: "position",
  pos: "position",
  team: "team",
  nfl_team: "team",
  value: "value",
  ktc_value: "value",
  points: "value",
  score: "value",
  ktc_id: "ktcId",
  ktcid: "ktcId",
  id: "ktcId",
  slug: "ktcId",
  rank: "rank",
  sf_rank: "rank",
  superflex_rank: "rank",
};

function coerceRow(raw: Record<string, unknown>): KtcImportRow | null {
  const row: Partial<KtcImportRow> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, "_");
    const field = FIELD_ALIASES[normalizedKey];
    if (!field || value === undefined || value === null || value === "") continue;
    if (field === "value" || field === "rank") {
      const num = typeof value === "number" ? value : Number(String(value).replace(/[,$]/g, ""));
      if (!Number.isNaN(num)) row[field] = num;
    } else {
      row[field] = String(value).trim();
    }
  }
  if (!row.name || row.value === undefined) return null;
  return row as KtcImportRow;
}

export function parseKtcCsv(text: string): KtcImportRow[] {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data.map(coerceRow).filter((r): r is KtcImportRow => r !== null);
}

export function parseKtcJson(text: string): KtcImportRow[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : Array.isArray(data.players) ? data.players : [];
  return arr.map(coerceRow).filter((r: KtcImportRow | null): r is KtcImportRow => r !== null);
}

const IMPLAUSIBLE_MAX = 10000;
const FLAG_RELATIVE_CHANGE = 0.75; // 75% in one observed step
const FLAG_MIN_ABSOLUTE_CHANGE = 800;
const BASELINE_FLAG_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export async function commitKtcImport(
  rows: KtcImportRow[],
  opts: { sourceUrl?: string; refreshRunId?: string; sourceType?: "MANUAL_CSV" | "MANUAL_JSON" | "AUTO_SCRAPE"; observedAt?: Date },
): Promise<KtcImportSummary> {
  const importBatchId = crypto.randomUUID();
  const now = opts.observedAt ?? new Date();
  const results: KtcImportRowResult[] = [];
  const usedPlayerIdsThisBatch = new Set<string>();

  // Pull all known players once; matching universe is players we already
  // know about via Sleeper sync (or prior imports), per identity-resolution
  // rules — name-only matching is a fallback, never the primary key.
  const allPlayers = await prisma.player.findMany();
  const byKtcId = new Map(allPlayers.filter((p) => p.ktcId).map((p) => [p.ktcId!, p]));
  const byNormalizedName = new Map<string, typeof allPlayers>();
  for (const p of allPlayers) {
    const list = byNormalizedName.get(p.normalizedName) ?? [];
    list.push(p);
    byNormalizedName.set(p.normalizedName, list);
  }

  for (const row of rows) {
    if (row.value < 0 || row.value > IMPLAUSIBLE_MAX) {
      results.push({ row, outcome: "rejected", detail: `Implausible value ${row.value}` });
      continue;
    }

    let player = row.ktcId ? byKtcId.get(row.ktcId) : undefined;
    if (!player) {
      const normalized = normalizePlayerName(row.name);
      const candidates = byNormalizedName.get(normalized) ?? [];
      const positionFiltered = row.position
        ? candidates.filter((c) => c.position === row.position)
        : candidates;
      const pool = positionFiltered.length > 0 ? positionFiltered : candidates;
      if (pool.length === 0) {
        results.push({ row, outcome: "unmatched", detail: "No matching rostered/known player found" });
        continue;
      }
      if (pool.length > 1) {
        results.push({
          row,
          outcome: "ambiguous",
          detail: `Matched ${pool.length} players by name — needs manual review`,
        });
        continue;
      }
      player = pool[0];
    }

    if (usedPlayerIdsThisBatch.has(player.id)) {
      results.push({
        row,
        outcome: "rejected",
        detail: "Duplicate mapping: another row in this import already resolved to this player",
        playerId: player.id,
      });
      continue;
    }
    usedPlayerIdsThisBatch.add(player.id);

    if (opts.refreshRunId) {
      const alreadyStored = await prisma.ktcObservation.findFirst({
        where: { playerId: player.id, refreshRunId: opts.refreshRunId },
        select: { id: true },
      });
      if (alreadyStored) {
        results.push({ row, outcome: "duplicate", detail: "Already stored for this refresh run", playerId: player.id });
        continue;
      }
    }

    const previous = await prisma.ktcObservation.findFirst({
      where: { playerId: player.id, validationStatus: "VALID" },
      orderBy: { observedAt: "desc" },
    });

    let validationStatus: "VALID" | "FLAGGED" = "VALID";
    let validationNote: string | undefined;
    if (previous) {
      const absChange = Math.abs(row.value - previous.value);
      const relChange = absChange / Math.max(previous.value, 1);
      const oldSeedBaseline =
        previous.sourceType === "SEED_BASELINE" &&
        now.getTime() - previous.observedAt.getTime() > BASELINE_FLAG_GRACE_MS;
      if (!oldSeedBaseline && relChange > FLAG_RELATIVE_CHANGE && absChange > FLAG_MIN_ABSOLUTE_CHANGE) {
        validationStatus = "FLAGGED";
        const prevDateLabel = previous.observedAt.toLocaleDateString("en-US", {
          timeZone: "America/New_York",
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        validationNote = `Changed ${previous.value} -> ${row.value} (${(relChange * 100).toFixed(0)}%) since ${prevDateLabel} — needs confirmation`;
      }
    }

    await prisma.ktcObservation.create({
      data: {
        playerId: player.id,
        value: row.value,
        format: KTC_FORMAT,
        observedAt: now,
        sourceType: (opts.sourceType ?? "MANUAL_CSV") as never,
        sourceUrl: opts.sourceUrl,
        importBatchId,
        refreshRunId: opts.refreshRunId,
        validationStatus,
        validationNote,
      },
    });

    if (row.ktcId && (!player.ktcId || player.mappingStatus !== "MAPPED")) {
      await prisma.player.update({
        where: { id: player.id },
        data: { ktcId: row.ktcId, mappingStatus: "MAPPED", mappingNote: null },
      });
    } else if (!player.ktcId && player.mappingStatus !== "MAPPED") {
      // Matched by name only — mark mapped so future imports match fast, but
      // note it was a name-based fallback match for auditability.
      await prisma.player.update({
        where: { id: player.id },
        data: { mappingStatus: "MAPPED", mappingNote: "Mapped via name-match fallback (no KTC id supplied)" },
      });
    }

    results.push({
      row,
      outcome: validationStatus === "VALID" ? "committed" : "flagged",
      detail: validationNote ?? "OK",
      playerId: player.id,
    });
  }

  return {
    importBatchId,
    totalRows: rows.length,
    committed: results.filter((r) => r.outcome === "committed").length,
    flagged: results.filter((r) => r.outcome === "flagged").length,
    rejected: results.filter((r) => r.outcome === "rejected").length,
    unmatched: results.filter((r) => r.outcome === "unmatched").length,
    ambiguous: results.filter((r) => r.outcome === "ambiguous").length,
    skippedDuplicates: results.filter((r) => r.outcome === "duplicate").length,
    results,
  };
}
