import Papa from "papaparse";

export type ScheduledGame = { season: number; week: number; teams: string[]; kickoff: number; completed: boolean };
export function parseNflSchedule(csv: string): ScheduledGame[] {
  const rows = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;
  return rows.filter(row => row.game_type === "REG" && row.gameday && row.gametime).map(row => {
    const nominal = new Date(`${row.gameday}T${row.gametime}:00Z`);
    const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(nominal).find(part => part.type === "timeZoneName")?.value;
    const offset = Number(zone?.match(/GMT([+-]\d+)/)?.[1]);
    return { season: Number(row.season), week: Number(row.week), teams: [row.home_team, row.away_team], kickoff: nominal.getTime() - offset * 3600000, completed: row.home_score !== "" && row.away_score !== "" };
  }).filter(row => Number.isFinite(row.kickoff));
}

export async function getNflSchedule(season: number) {
  const response = await fetch("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("NFL schedule unavailable; preserving pregame forecasts");
  const games = parseNflSchedule(await response.text()).filter(game => game.season === season);
  if (games.length < 200) throw new Error("NFL schedule incomplete; preserving pregame forecasts");
  return games;
}

export const scheduleTeam = (team: string) => ({ LA: "LA", LAR: "LA", JAC: "JAX", WSH: "WAS" }[team] ?? team);
