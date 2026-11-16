import { readFile, writeFile, rename } from 'node:fs/promises';
import Papa from 'papaparse';

const path = 'src/data/trade-matchups.json';
const history = JSON.parse(await readFile('src/data/league-history.json', 'utf8'));
const archive = JSON.parse(await readFile(path, 'utf8'));
const response = await fetch('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', { signal: AbortSignal.timeout(45000) });
if (!response.ok) throw new Error(`NFL schedule HTTP ${response.status}`);
const parsed = Papa.parse(await response.text(), { header: true, skipEmptyLines: true });
if (parsed.errors.length || !parsed.meta.fields?.includes('home_score')) throw new Error('Invalid NFL schedule');
const games = parsed.data;
const existing = new Map(archive.weeks.map(week => [`${week.leagueId}:${week.week}`, week]));
const jobs = [];
for (const season of history.seasons) {
  for (let week = 1; week <= 18; week++) {
    const rows = games.filter(game => game.season === season.season && game.game_type === 'REG' && Number(game.week) === week);
    if (!rows.length || rows.some(game => game.home_score === '' || game.away_score === '' || !game.gameday || !game.gametime)) continue;
    const key = `${season.leagueId}:${week}`;
    if (existing.has(key)) continue;
    const firstDay = rows.map(game => game.gameday).sort()[0];
    // Midnight UTC precedes every kickoff on the date and avoids DST errors.
    const start = Date.parse(firstDay + 'T00:00:00Z');
    jobs.push({ season: season.season, leagueId: season.leagueId, week, start });
  }
}
let cursor = 0;
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    const response = await fetch(`https://api.sleeper.app/v1/league/${job.leagueId}/matchups/${job.week}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Sleeper ${job.season} week ${job.week}: HTTP ${response.status}`);
    const data = await response.json();
    const managerCount = history.seasons.find(s => s.leagueId === job.leagueId)?.managers.length;
    if (!Array.isArray(data) || data.length !== managerCount || new Set(data.map(row => row.roster_id)).size !== managerCount ||
        data.some(row => !Array.isArray(row.players) || !Array.isArray(row.starters) || !Array.isArray(row.starters_points) || row.starters.length !== row.starters_points.length)) {
      throw new Error(`Incomplete Sleeper matchup data for ${job.season} week ${job.week}`);
    }
    const rows = data.map(({ roster_id, matchup_id, points, custom_points, players, starters, starters_points }) =>
      ({ roster_id, matchup_id, points, custom_points, players, starters, starters_points }));
    existing.set(`${job.leagueId}:${job.week}`, { ...job, rows });
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
const weeks = [...existing.values()].sort((a,b) => a.start - b.start);
const result = { ...archive, weeks, checkedAt: new Date().toISOString() };
const temp = path + '.tmp';
await writeFile(temp, JSON.stringify(result));
await rename(temp, path);
console.log(JSON.stringify({ added: jobs.map(j => `${j.season} week ${j.week}`), checkedAt: result.checkedAt }));
