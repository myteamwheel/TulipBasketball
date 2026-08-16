import type { PlayerRow } from "@/components/PlayerTable";
import type { TeamValuation } from "@/lib/teamMetrics";

export const CORE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export type PositionRank = {
  position: string;
  value: number;
  rank: number;
  leagueSize: number;
  leaderValue: number;
  shareOfRoster: number;
};

export function sourceGapPct(ktc: number | null, secondary: number | null): number | null {
  if (ktc === null || secondary === null || ktc <= 0) return null;
  return ((secondary - ktc) / ktc) * 100;
}

export function consensusGapPct(ktc: number | null, consensus: number | null): number | null {
  if (ktc === null || consensus === null || ktc <= 0) return null;
  return ((consensus - ktc) / ktc) * 100;
}

export function rangePositionPct(row: Pick<PlayerRow, "currentValue" | "high" | "low">): number | null {
  if (row.currentValue === null || row.high === null || row.low === null || row.high <= row.low) return null;
  return ((row.currentValue - row.low) / (row.high - row.low)) * 100;
}

export function priceZone(row: Pick<PlayerRow, "currentValue" | "high" | "low">): {
  label: string;
  detail: string;
  tone: "high" | "low" | "mid" | "flat";
} {
  const pct = rangePositionPct(row);
  if (pct === null) return { label: "Range forming", detail: "Not enough price separation yet", tone: "flat" };
  if (pct >= 85) return { label: "Peak zone", detail: `${Math.round(pct)}th percentile of tracked range`, tone: "high" };
  if (pct <= 15) return { label: "Floor zone", detail: `${Math.round(pct)}th percentile of tracked range`, tone: "low" };
  return { label: "Mid-range", detail: `${Math.round(pct)}th percentile of tracked range`, tone: "mid" };
}

export function movementLabel(change7dPct: number | null, change30dPct: number | null) {
  const seven = change7dPct ?? 0;
  const thirty = change30dPct ?? 0;
  if (seven >= 12) return { label: "Surging", detail: "Sharp 7-day repricing", tone: "up" as const };
  if (seven <= -12) return { label: "Sliding", detail: "Sharp 7-day selloff", tone: "down" as const };
  if (seven >= 4 && thirty >= 0) return { label: "Trending up", detail: "Positive short-term momentum", tone: "up" as const };
  if (seven <= -4 && thirty <= 0) return { label: "Trending down", detail: "Negative short-term momentum", tone: "down" as const };
  if (Math.sign(seven) !== 0 && Math.sign(thirty) !== 0 && Math.sign(seven) !== Math.sign(thirty)) {
    return { label: "Turning", detail: "7-day direction differs from 30-day trend", tone: "mixed" as const };
  }
  return { label: "Stable", detail: "No major directional move", tone: "flat" as const };
}

export function teamPositionRanks(valuations: TeamValuation[], managerId: string): PositionRank[] {
  const me = valuations.find((v) => v.managerId === managerId);
  if (!me) return [];
  return CORE_POSITIONS.map((position) => {
    const sorted = [...valuations].sort((a, b) => (b.positionalValue[position] ?? 0) - (a.positionalValue[position] ?? 0));
    const rank = sorted.findIndex((v) => v.managerId === managerId) + 1;
    const value = me.positionalValue[position] ?? 0;
    return {
      position,
      value,
      rank,
      leagueSize: valuations.length,
      leaderValue: sorted[0]?.positionalValue[position] ?? 0,
      shareOfRoster: me.totalValue > 0 ? value / me.totalValue : 0,
    };
  });
}

export function powerTier(rank: number, leagueSize: number): { label: string; detail: string } {
  if (rank <= 3) return { label: "Contender tier", detail: "Top-quarter market value" };
  if (rank <= Math.ceil(leagueSize / 2)) return { label: "Playoff-value tier", detail: "Above the league midpoint" };
  if (rank <= Math.ceil(leagueSize * 0.75)) return { label: "Bubble tier", detail: "Within striking distance of the top half" };
  return { label: "Build tier", detail: "Roster value trails the league core" };
}

export function actionPriority(signal: string | null | undefined): number {
  switch (signal) {
    case "CUT_BAIT": return 6;
    case "CUT_LOSSES": return 5;
    case "SELL_HIGH": return 4;
    case "BUY_LOW": return 3;
    case "WATCH": return 2;
    case "HOLD": return 1;
    default: return 0;
  }
}

export function signalActionCopy(signal: string | null | undefined): string {
  switch (signal) {
    case "SELL_HIGH": return "Shop the market; price is extended enough to test a sell.";
    case "BUY_LOW": return "Hold/add if possible; the dip has enough support to be interesting.";
    case "CUT_LOSSES": return "Explore an exit before another value leg down.";
    case "CUT_BAIT": return "Roster spot is under pressure; replace if a better stash exists.";
    case "WATCH": return "Do not force a move; wait for the next meaningful market/role signal.";
    case "HOLD": return "No forced action. Keep unless an offer beats market value.";
    default: return "No recommendation yet.";
  }
}

export function teamGapContext(valuations: TeamValuation[], managerId: string) {
  const ranked = [...valuations].sort((a, b) => b.totalValue - a.totalValue);
  const index = ranked.findIndex((v) => v.managerId === managerId);
  const me = ranked[index];
  if (!me) return null;
  const leader = ranked[0];
  const above = index > 0 ? ranked[index - 1] : null;
  const below = index >= 0 && index < ranked.length - 1 ? ranked[index + 1] : null;
  const playoffLine = ranked[Math.min(5, ranked.length - 1)] ?? null;
  return {
    rank: index + 1,
    leaderGap: leader.managerId === managerId ? 0 : leader.totalValue - me.totalValue,
    leaderName: leader.teamName,
    aboveGap: above ? above.totalValue - me.totalValue : 0,
    aboveName: above?.teamName ?? null,
    belowGap: below ? me.totalValue - below.totalValue : 0,
    belowName: below?.teamName ?? null,
    playoffLineGap: playoffLine ? me.totalValue - playoffLine.totalValue : 0,
    playoffLineTeam: playoffLine?.teamName ?? null,
  };
}
