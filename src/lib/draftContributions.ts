import matchupArchive from "@/data/trade-matchups.json";
import type { LeagueHistory } from "./leagueHistorySource";
import type { Selection } from "./draftGrades";

export type DraftContribution = {
  starts: number;
  points: number;
  seasons: { year: number; starts: number; points: number }[];
  coverage: { year: number; weeks: number }[];
};

/** Count verified weekly starts by the selecting manager, including later reacquisitions. */
export function draftContributions(picks: Selection[], history: LeagueHistory) {
  const result: Record<string, DraftContribution> = {};
  for (const pick of picks) {
    if (!pick.owner) continue;
    const seasons = new Map<number, { year: number; starts: number; points: number }>();
    const coverage = new Map<number, number>();
    for (const week of matchupArchive.weeks) {
      if (week.start <= Date.parse(pick.start)) continue;
      const season = history.seasons.find(s => s.leagueId === week.leagueId);
      const manager = season?.managers.find(m => m.ownerId === pick.owner);
      const row = week.rows.find(r => r.roster_id === manager?.rosterId);
      if (!row?.starters || !row.starters_points || row.starters.length !== row.starters_points.length) continue;
      coverage.set(Number(week.season), (coverage.get(Number(week.season)) ?? 0) + 1);
      const index = row.starters.indexOf(pick.playerId);
      if (index < 0 || !Number.isFinite(row.starters_points[index])) continue;
      const year = Number(week.season);
      const contribution = seasons.get(year) ?? { year, starts: 0, points: 0 };
      contribution.starts++;
      contribution.points += row.starters_points[index];
      seasons.set(year, contribution);
    }
    const rows = [...seasons.values()].sort((a,b) => a.year-b.year).map(s => ({...s, points:Math.round(s.points*100)/100}));
    result[pick.id] = { starts:rows.reduce((n,s)=>n+s.starts,0), points:Math.round(rows.reduce((n,s)=>n+s.points,0)*100)/100, seasons:rows, coverage:[...coverage].sort((a,b)=>a[0]-b[0]).map(([year,weeks])=>({year,weeks})) };
  }
  return result;
}
export const contributionChecked = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium" }).format(new Date(matchupArchive.checkedAt));
const latestWeek = matchupArchive.weeks.at(-1);
export const contributionCoverage = latestWeek ? `${latestWeek.season} week ${latestWeek.week}` : "unavailable";
