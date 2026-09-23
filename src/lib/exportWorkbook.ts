import { deflateRawSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getProjectionDashboardData } from "@/lib/playerProjections";

type Cell = string | number | boolean | null | undefined;
type Sheet = { name: string; headers: string[]; rows: Cell[][] };

function asIso(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function json(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 32000 ? `${text.slice(0, 31950)}…[truncated]` : text;
}

function xml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function colName(index: number) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellXml(value: Cell, row: number, column: number, header = false) {
  const ref = `${colName(column)}${row}`;
  const style = header ? ' s="1"' : "";
  if (typeof value === "number" && Number.isFinite(value))
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  if (typeof value === "boolean")
    return `<c r="${ref}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  const text = String(value ?? "");
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function sheetXml(sheet: Sheet) {
  const all = [sheet.headers, ...sheet.rows];
  const rows = all
    .map(
      (values, rowIndex) =>
        `<row r="${rowIndex + 1}">${values
          .map((value, colIndex) =>
            cellXml(value, rowIndex + 1, colIndex, rowIndex === 0),
          )
          .join("")}</row>`,
    )
    .join("");
  const lastCol = colName(Math.max(0, sheet.headers.length - 1));
  const lastRow = Math.max(1, all.length);
  const widths = sheet.headers
    .map((header, index) => {
      const sample = sheet.rows
        .slice(0, 200)
        .map((row) => String(row[index] ?? "").length);
      const width = Math.min(
        48,
        Math.max(10, String(header).length + 2, ...sample.map((n) => Math.min(n + 2, 48))),
      );
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCol}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${widths}</cols>
  <sheetData>${rows}</sheetData>
  <autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2) & 0x1f) >>> 0);
  const day =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, day };
}

function zip(files: Array<{ name: string; data: Buffer }>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = file.data;
    const compressed = deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralStart = offset;
  const centralBody = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBody.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBody, end]);
}

async function projectionLogRows() {
  try {
    return await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT id,"playerId","fullName",position,"nflTeam","ownerTeam",season,week,
             opponent,"modelVersion","projectionDate","refreshRunId",
             "projectedFantasyHalfPpr",completions,attempts,"passingYards","passingTds",
             interceptions,carries,"rushingYards","rushingTds",targets,receptions,
             "receivingYards","receivingTds","fumblesLost",confidence,"evidenceGames",
             "recentFantasyPpg","calibrationSample","calibrationBias","statusNote","createdAt"
      FROM "WeeklyPlayerProjection"
      ORDER BY season,week,"projectionDate","fullName"
    `);
  } catch {
    return [];
  }
}

export async function buildDynastyWorkbook() {
  const [
    league,
    managers,
    players,
    ownership,
    rosterHistory,
    ktc,
    market,
    consensus,
    transactions,
    refreshRuns,
    signals,
    notes,
    footballProfiles,
    footballGames,
    draftPicks,
    projectionLog,
    projectionDashboard,
  ] = await Promise.all([
    prisma.league.findFirst({ where: { sleeperId: SLEEPER_LEAGUE_ID } }),
    prisma.manager.findMany({
      where: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
      orderBy: { sleeperRosterId: "asc" },
    }),
    prisma.player.findMany({ orderBy: [{ position: "asc" }, { fullName: "asc" }] }),
    prisma.ownershipInterval.findMany({
      where: { manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } },
      include: {
        player: { select: { fullName: true, position: true } },
        manager: { select: { teamName: true, sleeperRosterId: true } },
      },
      orderBy: { validFrom: "asc" },
    }),
    prisma.rosterSnapshot.findMany({
      where: { manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } },
      include: {
        player: { select: { fullName: true, position: true } },
        manager: { select: { teamName: true, sleeperRosterId: true } },
      },
      orderBy: { observedAt: "asc" },
    }),
    prisma.ktcObservation.findMany({
      include: { player: { select: { fullName: true, position: true, nflTeam: true, sleeperId: true, ktcId: true } } },
      orderBy: [{ observedAt: "asc" }, { playerId: "asc" }],
    }),
    prisma.marketObservation.findMany({
      include: { player: { select: { fullName: true, position: true, nflTeam: true } } },
      orderBy: [{ observedAt: "asc" }, { source: "asc" }, { playerId: "asc" }],
    }),
    prisma.consensusObservation.findMany({
      include: { player: { select: { fullName: true, position: true, nflTeam: true } } },
      orderBy: [{ observedAt: "asc" }, { playerId: "asc" }],
    }),
    prisma.transaction.findMany({
      where: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
      orderBy: { sleeperCreatedAt: "asc" },
    }),
    prisma.refreshRun.findMany({
      where: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
      orderBy: { startedAt: "asc" },
    }),
    prisma.signal.findMany({
      include: { player: { select: { fullName: true, position: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.userNote.findMany({
      include: { player: { select: { fullName: true, position: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT pf.*,p."fullName",p."nflTeam"
      FROM "PlayerFootballProfile" pf
      JOIN "Player" p ON p.id=pf."playerId"
      ORDER BY p."fullName"
    `),
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT g."playerId",p."fullName",p.position,g."sleeperId",g."gsisId",
             g.season,g.week,g."seasonType",g.team,g.opponent,g."gameDate",
             g."fantasyHalfPpr",g.completions,g.attempts,g."passingYards",
             g."passingTds",g.interceptions,g.carries,g."rushingYards",
             g."rushingTds",g.targets,g.receptions,g."receivingYards",
             g."receivingTds",g."fumblesLost",g.grade,g."gradeScore",
             g."performanceSummary",g.source,g."sourceUpdatedAt",
             g."refreshRunId",g."observedAt"
      FROM "PlayerGameStat" g
      JOIN "Player" p ON p.id=g."playerId"
      ORDER BY g.season,g.week,p."fullName"
    `),
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT * FROM "DraftPickObservation" ORDER BY "observedAt",season,round,bucket
    `).catch(() => []),
    projectionLogRows(),
    getProjectionDashboardData(),
  ]);

  const managerName = new Map(
    managers.map((manager) => [
      manager.id,
      manager.teamName?.trim() || `Team ${manager.sleeperRosterId}`,
    ]),
  );

  const sheets: Sheet[] = [
    {
      name: "README",
      headers: ["Field", "Value"],
      rows: [
        ["Workbook", "Dynasty Boys complete history"],
        ["Exported at", new Date().toISOString()],
        ["League", league?.name ?? "Dynasty Boys"],
        ["Season", league?.season ?? ""],
        ["Format", league?.format ?? ""],
        ["Purpose", "Manual Excel backup generated from the dashboard's persisted database history. Every daily refresh adds new historical rows; this workbook is rebuilt from that ledger whenever downloaded."],
        ["Projection model", projectionDashboard.modelVersion],
        ["Current forecast", `${projectionDashboard.season} Week ${projectionDashboard.week}`],
        ["Projection integrity", "Historical accuracy uses only saved pregame projections. Games played before projection tracking began are not assigned hindsight forecasts."],
        ["Fantasy scoring", "Weekly forecasts use current Sleeper scoring for modeled box-score categories. Exotic threshold/bonus rules are not guaranteed in an expected stat line."],
      ],
    },
    {
      name: "Players",
      headers: ["player_id", "sleeper_id", "ktc_id", "name", "position", "nfl_team", "status", "mapping_status", "mapping_note", "created_at", "updated_at"],
      rows: players.map((p) => [p.id,p.sleeperId,p.ktcId,p.fullName,p.position,p.nflTeam,p.status,p.mappingStatus,p.mappingNote,asIso(p.createdAt),asIso(p.updatedAt)]),
    },
    {
      name: "Managers",
      headers: ["manager_id", "roster_id", "team_name", "primary", "active", "created_at", "updated_at"],
      rows: managers.map((m) => [m.id,m.sleeperRosterId,m.teamName?.trim() || `Team ${m.sleeperRosterId}`,m.isPrimaryTeam,m.isActive,asIso(m.createdAt),asIso(m.updatedAt)]),
    },
    {
      name: "Roster History",
      headers: ["observed_at", "refresh_run_id", "team", "roster_id", "player", "position", "slot", "player_id"],
      rows: rosterHistory.map((r) => [asIso(r.observedAt),r.refreshRunId,r.manager.teamName?.trim() || `Team ${r.manager.sleeperRosterId}`,r.manager.sleeperRosterId,r.player.fullName,r.player.position,r.slot,r.playerId]),
    },
    {
      name: "Ownership",
      headers: ["valid_from", "valid_to", "team", "roster_id", "player", "position", "source_transaction_id", "player_id"],
      rows: ownership.map((r) => [asIso(r.validFrom),asIso(r.validTo),r.manager.teamName?.trim() || `Team ${r.manager.sleeperRosterId}`,r.manager.sleeperRosterId,r.player.fullName,r.player.position,r.sourceTransactionId,r.playerId]),
    },
    {
      name: "KTC History",
      headers: ["observed_at","player","position","nfl_team","value","validation_status","source_type","source_url","format","refresh_run_id","import_batch_id","sleeper_id","ktc_id","validation_note","created_at"],
      rows: ktc.map((r) => [asIso(r.observedAt),r.player.fullName,r.player.position,r.player.nflTeam,r.value,r.validationStatus,r.sourceType,r.sourceUrl,r.format,r.refreshRunId,r.importBatchId,r.player.sleeperId,r.player.ktcId,r.validationNote,asIso(r.createdAt)]),
    },
    {
      name: "Market History",
      headers: ["observed_at","player","position","nfl_team","source","raw_value","normalized_value","source_updated_at","source_rank","position_rank","refresh_run_id","source_url","metadata","created_at"],
      rows: market.map((r) => [asIso(r.observedAt),r.player.fullName,r.player.position,r.player.nflTeam,r.source,r.rawValue,r.normalizedValue,asIso(r.sourceUpdatedAt),r.sourceRank,r.positionRank,r.refreshRunId,r.sourceUrl,r.metadata,asIso(r.createdAt)]),
    },
    {
      name: "Consensus",
      headers: ["observed_at","player","position","nfl_team","value","source_count","sources_used","weights","refresh_run_id","created_at"],
      rows: consensus.map((r) => [asIso(r.observedAt),r.player.fullName,r.player.position,r.player.nflTeam,r.value,r.sourceCount,r.sourcesUsed,r.weights,r.refreshRunId,asIso(r.createdAt)]),
    },
    {
      name: "Draft Picks",
      headers: ["observed_at","season","round","bucket","label","value","source_updated_at","source_url","refresh_run_id","created_at"],
      rows: draftPicks.map((r) => [asIso(r.observedAt as Date),r.season as number,r.round as number,r.bucket as string,r.label as string,r.value as number,asIso(r.sourceUpdatedAt as Date),r.sourceUrl as string,r.refreshRunId as string,asIso(r.createdAt as Date)]),
    },
    {
      name: "Football Profiles",
      headers: ["player","nfl_team","player_id","sleeper_id","gsis_id","position","draft_year","draft_round","draft_pick","draft_team","college","birth_date","source_updated_at","updated_at"],
      rows: footballProfiles.map((r) => [r.fullName as string,r.nflTeam as string,r.playerId as string,r.sleeperId as string,r.gsisId as string,r.position as string,r.draftYear as number,r.draftRound as number,r.draftPick as number,r.draftTeam as string,r.college as string,r.birthDate as string,asIso(r.sourceUpdatedAt as Date),asIso(r.updatedAt as Date)]),
    },
    {
      name: "NFL Game Stats",
      headers: ["season","week","season_type","player","position","team","opponent","fantasy_half_ppr","completions","attempts","passing_yards","passing_tds","interceptions","carries","rushing_yards","rushing_tds","targets","receptions","receiving_yards","receiving_tds","fumbles_lost","grade","grade_score","summary","source","source_updated_at","refresh_run_id","observed_at","player_id"],
      rows: footballGames.map((r) => [r.season as number,r.week as number,r.seasonType as string,r.fullName as string,r.position as string,r.team as string,r.opponent as string,r.fantasyHalfPpr as number,r.completions as number,r.attempts as number,r.passingYards as number,r.passingTds as number,r.interceptions as number,r.carries as number,r.rushingYards as number,r.rushingTds as number,r.targets as number,r.receptions as number,r.receivingYards as number,r.receivingTds as number,r.fumblesLost as number,r.grade as string,r.gradeScore as number,r.performanceSummary as string,r.source as string,asIso(r.sourceUpdatedAt as Date),r.refreshRunId as string,asIso(r.observedAt as Date),r.playerId as string]),
    },
    {
      name: "Current Forecast",
      headers: ["season","week","player","position","nfl_team","owner_team","opponent","projected_fantasy_points","recent_ppg","current_season_games","evidence_games","confidence","completions","attempts","passing_yards","passing_tds","interceptions","carries","rushing_yards","rushing_tds","targets","receptions","receiving_yards","receiving_tds","fumbles_lost","calibration_sample","calibration_bias","status"],
      rows: projectionDashboard.projections.map((r) => [r.season,r.week,r.fullName,r.position,r.nflTeam,r.ownerTeam,r.opponent,r.projectedFantasyHalfPpr,r.recentFantasyPpg,r.currentSeasonGames,r.evidenceGames,r.confidence,r.completions,r.attempts,r.passingYards,r.passingTds,r.interceptions,r.carries,r.rushingYards,r.rushingTds,r.targets,r.receptions,r.receivingYards,r.receivingTds,r.fumblesLost,r.calibrationSample,r.calibrationBias,r.statusNote]),
    },
    {
      name: "Projection Log",
      headers: ["projection_date","season","week","player","position","nfl_team","owner_team","opponent","projected_fantasy_points","confidence","evidence_games","recent_ppg","completions","attempts","passing_yards","passing_tds","interceptions","carries","rushing_yards","rushing_tds","targets","receptions","receiving_yards","receiving_tds","fumbles_lost","calibration_sample","calibration_bias","model_version","refresh_run_id","status"],
      rows: projectionLog.map((r) => [asIso(r.projectionDate as Date),r.season as number,r.week as number,r.fullName as string,r.position as string,r.nflTeam as string,r.ownerTeam as string,r.opponent as string,r.projectedFantasyHalfPpr as number,r.confidence as string,r.evidenceGames as number,r.recentFantasyPpg as number,r.completions as number,r.attempts as number,r.passingYards as number,r.passingTds as number,r.interceptions as number,r.carries as number,r.rushingYards as number,r.rushingTds as number,r.targets as number,r.receptions as number,r.receivingYards as number,r.receivingTds as number,r.fumblesLost as number,r.calibrationSample as number,r.calibrationBias as number,r.modelVersion as string,r.refreshRunId as string,r.statusNote as string]),
    },
    {
      name: "Projection Accuracy",
      headers: ["season","week","player","position","opponent","projected_fantasy_points","actual_fantasy_points","signed_error","absolute_error","confidence","projection_date","projected_stat_line","actual_stat_line"],
      rows: projectionDashboard.accuracy.map((r) => [r.season,r.week,r.fullName,r.position,r.opponent,r.projectedFantasyHalfPpr,r.actualFantasyHalfPpr,r.error,r.absoluteError,r.confidence,r.projectionDate,json(r.projectedStatLine),json(r.actualStatLine)]),
    },
    {
      name: "Transactions",
      headers: ["created_at","type","status","transaction_id","roster_ids","adds","drops","draft_picks","waiver_budget","processed_at"],
      rows: transactions.map((r) => [asIso(r.sleeperCreatedAt),r.type,r.status,r.sleeperTransactionId,r.rosterIdsInvolved,r.adds,r.drops,r.draftPicks,r.waiverBudget,asIso(r.processedAt)]),
    },
    {
      name: "Refresh Runs",
      headers: ["started_at","finished_at","status","run_id","requested_sources","sleeper_ok","ktc_ok","roster_changes","players_refreshed","mapping_warnings","errors","summary"],
      rows: refreshRuns.map((r) => [asIso(r.startedAt),asIso(r.finishedAt),r.status,r.id,r.requestedSources,r.sleeperSyncOk,r.ktcSyncOk,r.rosterChangesCount,r.playersRefreshed,r.mappingWarnings,r.errors,json(r.summary)]),
    },
    {
      name: "Signals",
      headers: ["created_at","player","position","signal","score","confidence","reason_codes","refresh_run_id"],
      rows: signals.map((r) => [asIso(r.createdAt),r.player.fullName,r.player.position,r.signal,r.score,r.confidence,r.reasonCodes,r.refreshRunId]),
    },
    {
      name: "Notes",
      headers: ["created_at","updated_at","player","position","body","tags"],
      rows: notes.map((r) => [asIso(r.createdAt),asIso(r.updatedAt),r.player.fullName,r.player.position,r.body,r.tags]),
    },
  ];

  const sheetFiles = sheets.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    data: Buffer.from(sheetXml(sheet), "utf8"),
  }));

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name.slice(0,31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const files = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(styles, "utf8") },
    ...sheetFiles,
  ];

  return {
    buffer: zip(files),
    sheetCount: sheets.length,
    rowCount: sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
    exportedAt: new Date(),
    currentForecastSeason: projectionDashboard.season,
    currentForecastWeek: projectionDashboard.week,
  };
}
