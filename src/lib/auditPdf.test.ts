import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditPdf } from "./auditPdf";
import type { AuditSnapshotData } from "./audit";

const team = {
  managerId: "orlando",
  teamName: "Orlando Oswalds",
  totalDynastyValue: 50_000,
  playerCapital: 42_000,
  draftCapital: 8_000,
  optimalLineupValue: 25_000,
  depthValue: 17_000,
  playerCount: 30,
  valuedPlayerCount: 30,
  missingValueCount: 0,
  draftPickCount: 8,
  capitalComplete: true,
  totalRank: 5,
  playerRank: 6,
  draftRank: 3,
  lineupRank: 7,
  depthRank: 4,
  positionalValue: { QB: 12_000, RB: 9_000, WR: 14_000, TE: 7_000 },
  positionalStarterValue: { QB: 8_000, RB: 5_000, WR: 8_000, TE: 4_000 },
  positionalDepthValue: { QB: 4_000, RB: 4_000, WR: 6_000, TE: 3_000 },
  positionRanks: { QB: 4, RB: 9, WR: 3, TE: 6 },
  change7d: 250,
  change30d: 900,
};

const fixture: AuditSnapshotData = {
  version: "orlando-audit-v1",
  snapshotDate: "2026-09-23",
  generatedAt: "2026-09-23T16:00:00.000Z",
  refreshRunId: "run-1",
  leagueName: "Dynasty Bois",
  leagueSeason: "2026",
  team,
  league: [team],
  roster: Array.from({ length: 40 }, (_, index) => ({
    playerId: `player-${index}`,
    name: `Player ${index}`,
    position: ["QB", "RB", "WR", "TE"][index % 4],
    nflTeam: "NFL",
    status: "Active",
    slot: index < 10 ? "STARTER" : "BENCH",
    value: 1000 + index,
    change7d: index,
    change30d: index * 2,
    observedAt: "2026-09-23T12:00:00.000Z",
  })),
  picks: [],
  activity: [
    { season: 2025, trades: 10, waiverClaims: 5, freeAgentAdds: 8, drops: 9 },
  ],
  projection: {
    season: 2026,
    week: 3,
    projected: 250,
    withheld: 100,
    classified: 350,
    rosteredSkillPlayers: 360,
    coverage: 350 / 360,
    orlandoProjectedPoints: 120.4,
  },
  health: {
    latestRefreshStatus: "SUCCESS",
    latestRefreshAt: "2026-09-23T12:00:00.000Z",
    rosteredPlayers: 360,
    valuedPlayers: 350,
    projectionReady: true,
    auditValidated: true,
  },
  recommendations: [
    { kind: "KEEP", title: "Keep flexibility", detail: "Retain useful picks." },
  ],
  changes: [
    {
      category: "CAPITAL",
      tone: "POSITIVE",
      title: "Capital increased",
      detail: "+250 since the prior snapshot.",
      magnitude: 250,
    },
  ],
};

test("audit PDF is a valid multi-page PDF with a cross-reference table", () => {
  const pdf = buildAuditPdf(fixture, [
    {
      snapshotDate: fixture.snapshotDate,
      generatedAt: fixture.generatedAt,
      refreshRunId: fixture.refreshRunId,
      teamValue: fixture.team.totalDynastyValue,
      teamRank: fixture.team.totalRank,
      playerCapital: fixture.team.playerCapital,
      draftCapital: fixture.team.draftCapital,
      lineupValue: fixture.team.optimalLineupValue,
      lineupRank: fixture.team.lineupRank,
      changeCount: fixture.changes.length,
    },
  ]);
  const text = pdf.toString("ascii");
  assert.equal(text.startsWith("%PDF-1.4"), true);
  assert.match(text, /\/Count [2-9]/);
  assert.match(text, /xref\n/);
  assert.match(text, /Orlando Oswalds - Dynasty Bois Audit/);
  assert.match(text, /%%EOF/);
});
