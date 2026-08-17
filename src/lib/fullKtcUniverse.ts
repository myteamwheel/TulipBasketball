import { prisma } from "@/lib/prisma";
import { KTC_FORMAT } from "@/lib/config";
import { commitKtcImport, type KtcImportRow } from "@/lib/ktcImport";
import { fetchKtcSnapshot } from "@/lib/marketSources";
import { normalizePlayerName } from "@/lib/normalize";
import { getPlayerCatalog, type SleeperPlayer } from "@/lib/sleeper";

const marketDb = prisma as typeof prisma & { marketObservation: any };
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

type CatalogCandidate = { sleeperId: string; meta: SleeperPlayer };

/**
 * Canonicalize KTC rows already written by the main market refresh. The market
 * observation knows KTC's effective source timestamp; KtcObservation used to
 * keep the HTTP fetch timestamp instead. Existing same-value/source-time rows
 * are rejected as duplicate heartbeats rather than deleted.
 */
export async function canonicalizeKtcRunTimestamps(refreshRunId: string): Promise<{ canonicalized: number; duplicatesRejected: number }> {
  const marketRows = await marketDb.marketObservation.findMany({
    where: { refreshRunId, source: "KTC" },
    select: { playerId: true, rawValue: true, sourceUpdatedAt: true, observedAt: true },
  });
  const anchorByPlayer = new Map<string, { value: number; at: Date }>();
  for (const row of marketRows as Array<{ playerId:string;rawValue:number;sourceUpdatedAt:Date|null;observedAt:Date }>) {
    anchorByPlayer.set(row.playerId, { value: Number(row.rawValue), at: row.sourceUpdatedAt ?? row.observedAt });
  }
  const ktcRows = await prisma.ktcObservation.findMany({ where: { refreshRunId, sourceType: "AUTO_SCRAPE" } });
  let canonicalized = 0, duplicatesRejected = 0;
  for (const row of ktcRows) {
    const anchor = anchorByPlayer.get(row.playerId);
    if (!anchor || row.value !== anchor.value) continue;
    const duplicate = await prisma.ktcObservation.findFirst({
      where: {
        id: { not: row.id },
        playerId: row.playerId,
        value: row.value,
        format: KTC_FORMAT,
        sourceType: "AUTO_SCRAPE",
        validationStatus: "VALID",
        observedAt: anchor.at,
      },
      select: { id: true },
    });
    if (duplicate) {
      await prisma.ktcObservation.update({ where: { id: row.id }, data: { validationStatus: "REJECTED", validationNote: "Duplicate KTC heartbeat at the same provider update timestamp." } });
      duplicatesRejected++;
    } else if (row.observedAt.getTime() !== anchor.at.getTime()) {
      await prisma.ktcObservation.update({ where: { id: row.id }, data: { observedAt: anchor.at } });
      canonicalized++;
    }
  }
  return { canonicalized, duplicatesRejected };
}

/**
 * Store the full current KTC board, not only players already rostered in this
 * league. Exact name+position matching against Sleeper's catalog is required
 * before a new Player identity is created; ambiguous identities are skipped.
 */
export async function refreshFullKtcUniverse(refreshRunId: string): Promise<{ matched: number; committed: number; marketRowsStored: number; sourceUpdatedAt: string }> {
  const [snapshot, catalog, existingPlayers] = await Promise.all([
    fetchKtcSnapshot(),
    getPlayerCatalog(),
    prisma.player.findMany(),
  ]);

  const byNamePos = new Map<string, CatalogCandidate[]>();
  for (const [sleeperId, meta] of Object.entries(catalog)) {
    const position = String(meta.position ?? "").toUpperCase();
    if (!FANTASY_POSITIONS.has(position)) continue;
    const fullName = meta.full_name ?? [meta.first_name, meta.last_name].filter(Boolean).join(" ");
    if (!fullName) continue;
    const key = `${normalizePlayerName(fullName)}|${position}`;
    const list = byNamePos.get(key) ?? [];
    list.push({ sleeperId, meta });
    byNamePos.set(key, list);
  }

  const existingByKtcId = new Map(existingPlayers.filter((p) => p.ktcId).map((p) => [p.ktcId!, p]));
  const existingBySleeper = new Map(existingPlayers.map((p) => [p.sleeperId, p]));
  const importRows: KtcImportRow[] = [];
  const providerRowByKtcId = new Map<string, (typeof snapshot.rows)[number]>();

  for (const row of snapshot.rows) {
    if (!row.ktcId || !row.position || !FANTASY_POSITIONS.has(row.position)) continue;
    let player = existingByKtcId.get(row.ktcId);
    if (!player) {
      const candidates = byNamePos.get(`${normalizePlayerName(row.name)}|${row.position}`) ?? [];
      if (candidates.length !== 1) continue;
      const { sleeperId, meta } = candidates[0];
      const fullName = meta.full_name ?? [meta.first_name, meta.last_name].filter(Boolean).join(" ") || row.name;
      const existing = existingBySleeper.get(sleeperId);
      if (existing) {
        player = await prisma.player.update({
          where: { id: existing.id },
          data: {
            ktcId: existing.ktcId ?? row.ktcId,
            fullName,
            normalizedName: normalizePlayerName(fullName),
            position: row.position,
            nflTeam: meta.team ?? row.team ?? existing.nflTeam,
            status: meta.injury_status ?? meta.status ?? existing.status,
            mappingStatus: "MAPPED",
            mappingNote: null,
          },
        });
      } else {
        player = await prisma.player.create({
          data: {
            sleeperId,
            ktcId: row.ktcId,
            fullName,
            normalizedName: normalizePlayerName(fullName),
            position: row.position,
            nflTeam: meta.team ?? row.team ?? null,
            status: meta.injury_status ?? meta.status ?? null,
            mappingStatus: "MAPPED",
          },
        });
      }
      existingByKtcId.set(row.ktcId, player);
      existingBySleeper.set(sleeperId, player);
    }
    importRows.push({ name: row.name, position: row.position, team: row.team, value: row.rawValue, ktcId: row.ktcId, rank: row.rank });
    providerRowByKtcId.set(row.ktcId, row);
  }

  const summary = await commitKtcImport(importRows, {
    sourceUrl: snapshot.sourceUrl,
    refreshRunId,
    sourceType: "AUTO_SCRAPE",
    observedAt: snapshot.sourceUpdatedAt,
  });

  let marketRowsStored = 0;
  for (const result of summary.results) {
    if (!result.playerId || !result.row.ktcId || ["flagged","rejected","ambiguous","unmatched"].includes(result.outcome)) continue;
    const row = providerRowByKtcId.get(result.row.ktcId);
    if (!row) continue;
    const exists = await marketDb.marketObservation.findFirst({ where: { refreshRunId, source: "KTC", playerId: result.playerId }, select: { id: true } });
    if (exists) continue;
    await marketDb.marketObservation.create({
      data: {
        playerId: result.playerId,
        source: "KTC",
        rawValue: row.rawValue,
        normalizedValue: Math.max(1, Math.min(10000, Math.round(row.rawValue))),
        observedAt: snapshot.sourceUpdatedAt,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        sourceUrl: snapshot.sourceUrl,
        refreshRunId,
        sourceRank: row.rank,
        positionRank: row.positionRank,
        metadata: JSON.stringify({ ...(row.metadata ?? {}), fullUniverse: true }),
      },
    });
    marketRowsStored++;
  }

  return { matched: importRows.length, committed: summary.committed, marketRowsStored, sourceUpdatedAt: snapshot.sourceUpdatedAt.toISOString() };
}
