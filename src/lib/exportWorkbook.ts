import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { ensureAnalyticsStorage } from "@/lib/weeklyProjection";

type Row = Record<string, unknown>;

function excelValue(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (value instanceof Date) return value;
  try {
    const text = JSON.stringify(value);
    return text.length > 32700
      ? `${text.slice(0, 32680)}…[truncated for Excel cell limit]`
      : text;
  } catch {
    return String(value);
  }
}

async function query(sql: string) {
  try {
    return await prisma.$queryRawUnsafe<Row[]>(sql);
  } catch {
    return [];
  }
}

function createStreamingWorkbook(filePath: string) {
  return new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: true,
    useSharedStrings: false,
  });
}

type StreamingWorkbook = ReturnType<typeof createStreamingWorkbook>;

function addRows(
  workbook: StreamingWorkbook,
  name: string,
  rows: Row[],
  description: string,
) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 2 }],
  });
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];

  if (keys.length) {
    keys.forEach((key, index) => {
      const sampleWidth = Math.max(
        key.length + 2,
        ...rows.slice(0, 80).map((row) => {
          const value = excelValue(row[key]);
          return value === null ? 0 : Math.min(36, String(value).length + 2);
        }),
      );
      sheet.getColumn(index + 1).width = Math.max(10, Math.min(36, sampleWidth));
    });
  } else {
    sheet.getColumn(1).width = 40;
  }

  const title = sheet.addRow([description]);
  title.font = { bold: true, size: 12 };
  title.commit();

  if (!keys.length) {
    sheet.addRow(["No rows available."]).commit();
    sheet.commit();
    return;
  }

  const header = sheet.addRow(keys);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: "thin" } };
  });
  header.commit();

  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: keys.length },
  };

  for (const row of rows) {
    sheet.addRow(keys.map((key) => excelValue(row[key]))).commit();
  }
  sheet.commit();
}

export async function buildCompleteDataWorkbook() {
  await ensureAnalyticsStorage();

  const leagueClause = `l."sleeperId" = '${SLEEPER_LEAGUE_ID.replaceAll("'", "''")}'`;
  const tempPath = join(
    tmpdir(),
    `dynasty-boys-${Date.now()}-${randomUUID()}.xlsx`,
  );
  const workbook = createStreamingWorkbook(tempPath);

  try {
    const readme = workbook.addWorksheet("README");
    readme.getColumn(1).width = 28;
    readme.getColumn(2).width = 92;
    const title = readme.addRow(["Dynasty Boys complete data export", ""]);
    title.font = { bold: true, size: 14 };
    title.commit();
    [
      ["Generated", new Date().toISOString()],
      ["League", SLEEPER_LEAGUE_ID],
      [
        "What is included",
        "Every historical row currently retained by the dashboard for refreshes, roster snapshots, ownership, KTC, independent market feeds, consensus, transactions, football profiles, NFL game stats, model signals, weekly projections, projection eligibility/source inputs, and projection accuracy.",
      ],
      [
        "Daily append behavior",
        "The database is the append-only source of truth. Each morning refresh adds new observations and records a DailyExportSnapshot. This workbook is rebuilt on demand from that complete history, so exporting later never depends on preserving one fragile binary spreadsheet file.",
      ],
      [
        "Projection history",
        "Weekly Projections preserves daily pregame snapshots. Once nflverse reports the actual game, those snapshots are graded and the latest pregame projection is used by the website's accuracy view.",
      ],
    ].forEach((row) => readme.addRow(row).commit());
    readme.commit();

    const sheets = [
      {
        name: "Refresh Runs",
        description: "Daily ingestion / refresh history",
        sql: `
          SELECT rr.id AS "runId", rr."startedAt", rr."finishedAt", rr.status,
            rr."sleeperSyncOk", rr."ktcSyncOk", rr."rosterChangesCount",
            rr."playersRefreshed", rr."requestedSources", rr."mappingWarnings",
            rr.errors, rr.summary
          FROM "RefreshRun" rr
          JOIN "League" l ON l.id = rr."leagueId"
          WHERE ${leagueClause}
          ORDER BY rr."startedAt" ASC
        `,
      },
      {
        name: "Current Rosters",
        description: "Current Sleeper ownership",
        sql: `
          SELECT COALESCE(m."teamName", m."displayName") AS "fantasyTeam",
            m."sleeperRosterId", p."sleeperId", p."fullName", p.position,
            p."nflTeam", oi."validFrom"
          FROM "OwnershipInterval" oi
          JOIN "Manager" m ON m.id = oi."managerId"
          JOIN "League" l ON l.id = m."leagueId"
          JOIN "Player" p ON p.id = oi."playerId"
          WHERE oi."validTo" IS NULL AND m."isActive" = true AND ${leagueClause}
          ORDER BY m."sleeperRosterId", p.position, p."fullName"
        `,
      },
      {
        name: "Roster History",
        description: "Point-in-time roster snapshots from each refresh",
        sql: `
          SELECT rs."observedAt", rs.slot,
            COALESCE(m."teamName", m."displayName") AS "fantasyTeam",
            m."sleeperRosterId", p."sleeperId", p."fullName", p.position,
            p."nflTeam", rs."refreshRunId"
          FROM "RosterSnapshot" rs
          JOIN "Manager" m ON m.id = rs."managerId"
          JOIN "League" l ON l.id = m."leagueId"
          JOIN "Player" p ON p.id = rs."playerId"
          WHERE ${leagueClause}
          ORDER BY rs."observedAt", m."sleeperRosterId", p."fullName"
        `,
      },
      {
        name: "Ownership History",
        description: "Ownership intervals inferred from Sleeper changes",
        sql: `
          SELECT oi."validFrom", oi."validTo", oi."sourceTransactionId",
            COALESCE(m."teamName", m."displayName") AS "fantasyTeam",
            m."sleeperRosterId", p."sleeperId", p."fullName", p.position
          FROM "OwnershipInterval" oi
          JOIN "Manager" m ON m.id = oi."managerId"
          JOIN "League" l ON l.id = m."leagueId"
          JOIN "Player" p ON p.id = oi."playerId"
          WHERE ${leagueClause}
          ORDER BY oi."validFrom", m."sleeperRosterId", p."fullName"
        `,
      },
      {
        name: "KTC History",
        description: "KTC value observations and validation status",
        sql: `
          SELECT ko."observedAt", p."sleeperId", p."ktcId", p."fullName",
            p.position, p."nflTeam", ko.value, ko.format, ko."sourceType",
            ko."validationStatus", ko."validationNote", ko."sourceUrl",
            ko."refreshRunId"
          FROM "KtcObservation" ko
          JOIN "Player" p ON p.id = ko."playerId"
          ORDER BY ko."observedAt", p."fullName"
        `,
      },
      {
        name: "Market History",
        description: "All independent market-source observations",
        sql: `
          SELECT mo."observedAt", mo."sourceUpdatedAt", mo.source,
            p."sleeperId", p."fullName", p.position, p."nflTeam",
            mo."rawValue", mo."normalizedValue", mo."sourceRank",
            mo."positionRank", mo."sourceUrl", mo.metadata, mo."refreshRunId"
          FROM "MarketObservation" mo
          JOIN "Player" p ON p.id = mo."playerId"
          ORDER BY mo."observedAt", mo.source, p."fullName"
        `,
      },
      {
        name: "Consensus",
        description: "Trusted market consensus history",
        sql: `
          SELECT co."observedAt", p."sleeperId", p."fullName", p.position,
            p."nflTeam", co.value, co."sourceCount", co."sourcesUsed",
            co.weights, co."refreshRunId"
          FROM "ConsensusObservation" co
          JOIN "Player" p ON p.id = co."playerId"
          ORDER BY co."observedAt", p."fullName"
        `,
      },
      {
        name: "Transactions",
        description: "Sleeper transactions with raw payloads",
        sql: `
          SELECT t."sleeperCreatedAt", t."sleeperTransactionId", t.type, t.status,
            t."rosterIdsInvolved", t.adds, t.drops, t."draftPicks",
            t."waiverBudget", t."rawPayload", t."processedAt"
          FROM "Transaction" t
          JOIN "League" l ON l.id = t."leagueId"
          WHERE ${leagueClause}
          ORDER BY t."sleeperCreatedAt"
        `,
      },
      {
        name: "Football Profiles",
        description: "nflverse / identity football profiles",
        sql: `
          SELECT p."sleeperId", p."fullName", p.position, p."nflTeam",
            pf."gsisId", pf."displayName", pf."draftYear", pf."draftRound",
            pf."draftPick", pf."draftTeam", pf.college, pf."birthDate",
            pf."sourceUpdatedAt", pf."updatedAt"
          FROM "PlayerFootballProfile" pf
          JOIN "Player" p ON p.id = pf."playerId"
          ORDER BY p."fullName"
        `,
      },
      {
        name: "NFL Game Stats",
        description: "Regular-season game stat history used by the model",
        sql: `
          SELECT gs.season, gs.week, gs."seasonType", p."sleeperId",
            p."fullName", p.position, gs.team, gs.opponent,
            gs."fantasyHalfPpr", gs.completions, gs.attempts,
            gs."passingYards", gs."passingTds", gs.interceptions,
            gs.carries, gs."rushingYards", gs."rushingTds", gs.targets,
            gs.receptions, gs."receivingYards", gs."receivingTds",
            gs."fumblesLost", gs.grade, gs."gradeScore",
            gs."performanceSummary", gs.source, gs."sourceUpdatedAt",
            gs."observedAt", gs."refreshRunId", gs."rawPayload"
          FROM "PlayerGameStat" gs
          JOIN "Player" p ON p.id = gs."playerId"
          ORDER BY gs.season, gs.week, p."fullName"
        `,
      },
      {
        name: "Weekly Projections",
        description: "Every saved daily weekly projection snapshot, including external source inputs",
        sql: `
          SELECT wp."asOfDate", wp.season, wp.week, wp."playerName",
            wp.position, wp."nflTeam", wp."projectedFantasyPoints",
            wp."expectedFantasyPoints", wp."projectedStats", wp."sourceInputs",
            wp."sourceCount", wp.confidence, wp."sampleGames",
            wp."calibrationFactor", wp."modelVersion", wp."refreshRunId",
            wp."createdAt"
          FROM "WeeklyProjection" wp
          ORDER BY wp.season, wp.week, wp."asOfDate", wp."playerName"
        `,
      },
      {
        name: "Projection Eligibility",
        description: "Daily record of projected, withheld, and already-played rostered players",
        sql: `
          SELECT pa."asOfDate", pa.season, pa.week, pa."playerName",
            pa.position, pa."nflTeam", pa.status, pa.reason,
            pa."sourceInputs", pa."refreshRunId", pa."createdAt"
          FROM "ProjectionAvailability" pa
          ORDER BY pa.season, pa.week, pa."asOfDate", pa."playerName"
        `,
      },
      {
        name: "Projection Accuracy",
        description: "Projected vs actual results and error metrics",
        sql: `
          SELECT wp.season, wp.week, wp."asOfDate", wp."playerName",
            wp.position, wp."nflTeam", wp."projectedFantasyPoints",
            wp."actualFantasyPoints", wp."absoluteError", wp."signedError",
            wp."accuracyScore", wp."projectedStats", wp."actualStats",
            wp.confidence, wp."sampleGames", wp."calibrationFactor",
            wp."modelVersion", wp."gradedAt"
          FROM "WeeklyProjection" wp
          WHERE wp."actualFantasyPoints" IS NOT NULL
          ORDER BY wp.season, wp.week, wp."playerName", wp."asOfDate"
        `,
      },
      {
        name: "Signals",
        description: "Historical model signals",
        sql: `
          SELECT s."createdAt", p."sleeperId", p."fullName", p.position,
            s.signal, s.score, s.confidence, s."reasonCodes", s."refreshRunId"
          FROM "Signal" s
          JOIN "Player" p ON p.id = s."playerId"
          ORDER BY s."createdAt", p."fullName"
        `,
      },
      {
        name: "Daily Snapshots",
        description: "Daily export/audit row-count snapshots",
        sql: `
          SELECT "snapshotDate", "refreshRunId", "rowCounts", "createdAt"
          FROM "DailyExportSnapshot"
          ORDER BY "snapshotDate"
        `,
      },
    ];

    for (const sheet of sheets) {
      const rows = await query(sheet.sql);
      addRows(workbook, sheet.name, rows, sheet.description);
    }

    await workbook.commit();
    return await readFile(tempPath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}
