import { readFile, writeFile } from 'node:fs/promises';
import Papa from 'papaparse';
const history = JSON.parse(await readFile('src/data/league-history.json','utf8'));
const games = Papa.parse(await readFile('/private/tmp/dynasty-nfl-games.csv','utf8'),{header:true,skipEmptyLines:true}).data;
const jobs=[];
for (const season of history.seasons) for (let week=1;week<=18;week++) {
  const rows=games.filter(g=>g.season===season.season && g.game_type==='REG' && Number(g.week)===week);
  if (!rows.length || rows.some(g=>!g.home_score || !g.away_score || !g.gameday || !g.gametime)) continue;
  // NFL schedules use Eastern local times. Require an entire week after the trade.
  const start=rows.map(g=>new Date(`${g.gameday}T${g.gametime}:00-05:00`).getTime()-3600000).sort((a,b)=>a-b)[0];
  jobs.push({season:season.season,leagueId:season.leagueId,week,start});
}
let cursor=0;const weeks=[];
async function worker(){while(cursor<jobs.length){const job=jobs[cursor++];const r=await fetch(`https://api.sleeper.app/v1/league/${job.leagueId}/matchups/${job.week}`,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error(`matchups ${job.season} ${job.week}: ${r.status}`);const rows=await r.json();if(rows.length)weeks.push({...job,rows:rows.map(({roster_id,matchup_id,points,custom_points,players,starters,starters_points})=>({roster_id,matchup_id,points,custom_points,players,starters,starters_points}))});}}
await Promise.all(Array.from({length:5},worker));
const catalogResponse=await fetch('https://api.sleeper.app/v1/players/nfl',{signal:AbortSignal.timeout(60000)});if(!catalogResponse.ok)throw Error('Sleeper player catalog unavailable');const catalog=await catalogResponse.json();
const retired=Object.entries(catalog).filter(([,p])=>p.active===false && String(p.status).toLowerCase()==='retired').map(([id])=>id);
await writeFile('src/data/trade-matchups.json',JSON.stringify({weeks:weeks.sort((a,b)=>a.start-b.start),retired,checkedAt:new Date().toISOString()}));console.log(JSON.stringify({weeks:weeks.length,retired:retired.length}));
