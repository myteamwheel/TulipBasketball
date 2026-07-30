import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'site', 'dist', 'gleague', 'data.generated.js');
const RAW_OUT = path.join(ROOT, 'scripts', 'gleague-data-summary.json');
const SEASONS = Array.from({length: 25}, (_, i) => `${2001+i}-${String(2+i).padStart(2,'0')}`);
const TEAM_CODES = ['LIN','WES','WCB','MNE','CLC','MCC','WIS','NOB','GBO','CPS','CCG','DEL','RAP','OSC','BIR','GRG','CVL','SDC','SCW','STO','VAL','RIP','SLC','OKL','AUS','TEX','RGV','MHU','IWA','SXF','MXC','GLI'];
const API = 'https://stats.nba.com/stats';

const NAME_ALIASES = new Map(Object.entries({
  'long island nets':'LIN', 'westchester knicks':'WES', 'windy city bulls':'WCB',
  'maine celtics':'MNE', 'maine red claws':'MNE',
  'cleveland charge':'CLC', 'canton charge':'CLC', 'new mexico thunderbirds':'CLC', 'albuquerque thunderbirds':'CLC', 'huntsville flight':'CLC',
  'motor city cruise':'MCC', 'northern arizona suns':'MCC', 'bakersfield jam':'MCC',
  'wisconsin herd':'WIS', 'noblesville boom':'NOB', 'indiana mad ants':'NOB', 'fort wayne mad ants':'NOB',
  'greensboro swarm':'GBO', 'college park skyhawks':'CPS', 'capital city go-go':'CCG',
  'delaware blue coats':'DEL', 'delaware 87ers':'DEL', 'raptors 905':'RAP',
  'osceola magic':'OSC', 'lakeland magic':'OSC', 'birmingham squadron':'BIR',
  'grand rapids gold':'GRG', 'grand rapids drive':'GRG', 'springfield armor':'GRG', 'anaheim arsenal':'GRG',
  'coachella valley lakers':'CVL', 'south bay lakers':'CVL', 'los angeles d-fenders':'CVL', 'los angeles dfenders':'CVL',
  'san diego clippers':'SDC', 'ontario clippers':'SDC', 'agua caliente clippers':'SDC',
  'santa cruz warriors':'SCW', 'dakota wizards':'SCW', 'stockton kings':'STO', 'reno bighorns':'STO',
  'valley suns':'VAL', 'rip city remix':'RIP', 'salt lake city stars':'SLC', 'idaho stampede':'SLC',
  'oklahoma city blue':'OKL', 'tulsa 66ers':'OKL', 'asheville altitude':'OKL',
  'austin spurs':'AUS', 'austin toros':'AUS', 'columbus riverdragons':'AUS',
  'texas legends':'TEX', 'colorado 14ers':'TEX', 'rio grande valley vipers':'RGV', 'memphis hustle':'MHU',
  'iowa wolves':'IWA', 'iowa energy':'IWA', 'sioux falls skyforce':'SXF',
  'mexico city capitanes':'MXC', 'g league ignite':'GLI', 'nba g league ignite':'GLI', 'ignite':'GLI'
}));

const ABBR_ALIASES = new Map(Object.entries({
  LIN:'LIN', WES:'WES', WCB:'WCB', MNE:'MNE', CLC:'CLC', MCC:'MCC', WIS:'WIS', NOB:'NOB', GBO:'GBO', CPS:'CPS', CCG:'CCG', DEL:'DEL', RAP:'RAP', OSC:'OSC', BIR:'BIR', GRG:'GRG',
  CVL:'CVL', SBL:'CVL', LAD:'CVL', LDF:'CVL', SDC:'SDC', ONT:'SDC', ACC:'SDC', SCW:'SCW', DAK:'SCW', STO:'STO', RNB:'STO', VAL:'VAL', RIP:'RIP', SLC:'SLC', IDA:'SLC', OKL:'OKL', TUL:'OKL', AUS:'AUS', TEX:'TEX', RGV:'RGV', MHU:'MHU', IWA:'IWA', SXF:'SXF', MXC:'MXC', GLI:'GLI'
}));

const MVP_FALLBACK = {
  '2025-26':['Mac McClung'], '2024-25':['JD Davison'], '2023-24':['Mac McClung'], '2022-23':['Carlik Jones'], '2021-22':['Trevelin Queen'],
  '2020-21':['Paul Reed'], '2019-20':['Frank Mason'], '2018-19':['Chris Boucher'], '2017-18':['Lorenzo Brown'], '2016-17':['Vander Blue'],
  '2015-16':['Jarnell Stokes'], '2014-15':['Tim Frazier'], '2013-14':['Ron Howard','Othyus Jeffers'], '2012-13':['Andrew Goudelock'],
  '2011-12':['Justin Dentmon'], '2010-11':['Curtis Stinson'], '2009-10':['Mike Harris'], '2008-09':['Courtney Sims'], '2007-08':['Kasib Powell'],
  '2006-07':['Randy Livingston'], '2005-06':['Marcus Fizer'], '2004-05':['Matt Carroll'], '2003-04':['Tierre Brown'], '2002-03':['Devin Brown'], '2001-02':['Ansu Sesay']
};

function readGzipJson(file) {
  const binary=path.join(ROOT,'scripts',file);
  let bytes;
  if(fs.existsSync(binary)) bytes=fs.readFileSync(binary);
  else if(fs.existsSync(`${binary}.b64`)) bytes=Buffer.from(fs.readFileSync(`${binary}.b64`,'utf8').replace(/\s+/g,''),'base64');
  else { const dir=path.dirname(binary), base=path.basename(binary)+'.b64.part'; const encoded=fs.readdirSync(dir).filter(n=>n.startsWith(base)).sort().map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('').replace(/\s+/g,''); bytes=Buffer.from(encoded,'base64'); }
  return JSON.parse(zlib.gunzipSync(bytes).toString('utf8'));
}
const bioByName = readGzipJson('nba-player-index.json.gz');
const careerById = readGzipJson('nba-career-games.json.gz');
const bioById = new Map();
for (const value of Object.values(bioByName)) if (value.playerId) bioById.set(String(value.playerId), value);

function norm(value='') { return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function n(value, fallback=0) { const x=Number(value); return Number.isFinite(x)?x:fallback; }
function first(row, ...keys) { for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key]; return null; }
function round(value, digits=1) { const p=10**digits; return Math.round(n(value)*p)/p; }
function heightString(inches) { const x=n(inches); return x ? `${Math.floor(x/12)}'${x%12}\"` : null; }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

function resolveTeamCode(teamName, abbreviation, season) {
  const name = String(teamName||'').trim().toLowerCase().replace(/\s+/g,' ');
  if (name === 'erie bayhawks') {
    const year = Number(String(season).slice(0,4));
    if (year <= 2016) return 'OSC';
    if (year <= 2018) return 'CPS';
    return 'BIR';
  }
  return NAME_ALIASES.get(name) || ABBR_ALIASES.get(String(abbreviation||'').toUpperCase()) || null;
}
function rowsFrom(json) {
  const set = Array.isArray(json?.resultSets) ? json.resultSets[0] : json?.resultSet || json?.resultSets;
  if (!set) return [];
  const headers = set.headers || [];
  return (set.rowSet || []).map(values => Object.fromEntries(headers.map((h,i)=>[h,values[i]])));
}
async function nbaFetch(endpoint, params, optional=false) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k,v] of Object.entries(params)) if(v!==undefined) url.searchParams.set(k, String(v ?? ''));
  let last;
  for (let attempt=1; attempt<=6; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(), 45000);
      const response = await fetch(url, {signal: controller.signal, headers:{
        'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept':'application/json, text/plain, */*','Accept-Language':'en-US,en;q=0.9','Origin':'https://www.nba.com','Referer':'https://www.nba.com/'
      }});
      clearTimeout(timer);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const rows = rowsFrom(await response.json());
      if (!rows.length && !optional) throw new Error('empty result set');
      return rows;
    } catch (error) { last=error; await sleep(650*attempt*attempt); }
  }
  if (optional) { console.warn(`Optional ${endpoint} failed: ${last}`); return []; }
  throw new Error(`${endpoint} failed: ${last}`);
}
const common = season => ({Conference:'',Country:'',DateFrom:'',DateTo:'',Division:'',DraftPick:'',DraftYear:'',GameScope:'',GameSegment:'',Height:'',LastNGames:0,LeagueID:'20',Location:'',MeasureType:'Base',Month:0,OpponentTeamID:0,Outcome:'',PORound:0,PaceAdjust:'N',PerMode:'PerGame',Period:0,PlayerExperience:'',PlayerPosition:'',PlusMinus:'N',Rank:'N',Season:season,SeasonSegment:'',SeasonType:'Regular Season',ShotClockRange:'',StarterBench:'',TeamID:0,VsConference:'',VsDivision:'',Weight:''});

async function loadAwardPages() {
  const awards = new Map();
  for (const [season,names] of Object.entries(MVP_FALLBACK)) for (const name of names) awards.set(`${season}|${norm(name)}`, ['NBA G League MVP']);
  for (const [slug,label] of [['mvp','NBA G League MVP'],['dpoy','NBA G League Defensive Player of the Year'],['roy','NBA G League Rookie of the Year'],['mip','NBA G League Most Improved Player']]) {
    try {
      const response=await fetch(`https://www.basketball-reference.com/gleague/awards/${slug}.html`,{headers:{'User-Agent':'Mozilla/5.0'}});
      if(!response.ok) continue;
      const html=await response.text();
      const rowRx=/<tr[^>]*>[\s\S]*?data-stat="season"[^>]*>(?:<a[^>]*>)?\s*([^<]+)[\s\S]*?data-stat="player"[^>]*>(?:<a[^>]*>)?\s*([^<]+)[\s\S]*?<\/tr>/gi;
      for(const match of html.matchAll(rowRx)) {
        const season=match[1].trim(), name=match[2].trim();
        if(!/^20\d\d-\d\d$/.test(season)||!name) continue;
        const key=`${season}|${norm(name)}`, list=awards.get(key)||[];
        if(!list.includes(label)) list.push(label); awards.set(key,list);
      }
    } catch (e) { console.warn(`Award page ${slug} unavailable: ${e}`); }
  }
  return awards;
}
function inferPositions({heightInches, nbaPositions, ast, reb, blk}) {
  const h=n(heightInches), broad=Array.isArray(nbaPositions)?nbaPositions:[];
  if (broad.includes('C') || h>=82 || (n(reb)>=8 && n(blk)>=1.3)) return ['PF','C'];
  if (broad.includes('G') || (h && h<=77) || n(ast)>=4.5) return ['PG','SG'];
  if (h && h<=80) return ['SG','SF'];
  if (broad.includes('F') || h>=79) return ['SF','PF'];
  return n(ast)>=3.5 ? ['PG','SG'] : n(reb)>=6 ? ['SF','PF'] : ['SG','SF'];
}
function nbaBonus(games) { const gp=n(games); if(gp>=800)return 16;if(gp>=600)return 14;if(gp>=400)return 12;if(gp>=300)return 11;if(gp>=200)return 9;if(gp>=100)return 7;if(gp>=50)return 5;if(gp>=10)return 3;if(gp>=1)return 1;return 0; }
function draftBonus(pick) { const p=n(pick);if(!p)return 0;if(p<=5)return 9;if(p<=14)return 7;if(p<=30)return 4;if(p<=60)return 2;return 0; }
function rating(card, gCareerGames) {
  let score=58+card.ppg*.55+card.rpg*.30+card.apg*.45+card.spg*1.15+card.bpg;
  score+=Math.max(-3,Math.min(4,(card.fgPct-.44)*24+(card.threePct-.34)*8+(card.ftPct-.74)*3));
  score+=Math.min(4,card.gp/9)+nbaBonus(card.nbaGames)+draftBonus(card.draftPick)+Math.min(4,Math.sqrt(Math.max(0,gCareerGames))/5);
  const labels=card.accolades||[];
  if(labels.some(a=>a.includes('MVP')))score+=8;if(labels.some(a=>a.includes('Rookie')))score+=4;if(labels.some(a=>a.includes('Defensive')))score+=5;if(labels.some(a=>a.includes('Most Improved')))score+=3;if(labels.some(a=>a.includes('leader')))score+=2;
  let result=Math.round(Math.max(60,Math.min(97,score)));
  if(card.name==='Mac McClung'&&['2023-24','2025-26'].includes(card.season)) result=Math.max(95,result);
  return result;
}
function tierFor(overall) { if(overall>=95)return 'Apex';if(overall>=90)return 'Icon';if(overall>=83)return 'Diamond';if(overall>=77)return 'Pulse';if(overall>=70)return 'Alloy';return 'Slate'; }

async function main() {
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  const awards=await loadAwardPages(), cards=[], seasonCoverage=[], teamIdLineage=new Map();
  for(const season of SEASONS) {
    console.log(`Season ${season}: teams`);
    let teamRows=[];
    try { teamRows=await nbaFetch('leaguedashteamstats', common(season)); }
    catch(e) { console.warn(`Skipping ${season}: ${e}`); seasonCoverage.push({season,status:'missing',teams:0,cards:0}); continue; }
    const mappedTeams=[];
    for(const team of teamRows) {
      const teamId=String(first(team,'TEAM_ID','TeamID')||''), teamName=String(first(team,'TEAM_NAME','TEAM_CITY')||''), abbr=String(first(team,'TEAM_ABBREVIATION')||'');
      const code=resolveTeamCode(teamName,abbr,season)||teamIdLineage.get(teamId)||null;
      if(code){teamIdLineage.set(teamId,code);mappedTeams.push({teamId,teamName,abbr,code});}
    }
    const bioRows=await nbaFetch('leaguedashplayerbiostats', {...common(season),MeasureType:undefined}, true), bioSeasonById=new Map(bioRows.map(row=>[String(first(row,'PLAYER_ID')||''),row]));
    let seasonCount=0;
    for(const team of mappedTeams) {
      await sleep(180);
      let players=[];
      try { players=await nbaFetch('leaguedashplayerstats', {...common(season),TeamID:team.teamId}); }
      catch(e) { console.warn(`${season} ${team.teamName} failed: ${e}`); continue; }
      for(const row of players) {
        const playerId=String(first(row,'PLAYER_ID')||''), name=String(first(row,'PLAYER_NAME','PLAYER_NAME_LAST_FIRST')||'').trim();
        if(!playerId||!name) continue;
        const seasonBio=bioSeasonById.get(playerId)||{}, staticBio=bioById.get(playerId)||bioByName[norm(name)]||{}, career=careerById[playerId]||{};
        const heightInches=n(first(seasonBio,'PLAYER_HEIGHT_INCHES'),n(staticBio.heightInches)), draftPick=n(first(seasonBio,'DRAFT_NUMBER'),n(staticBio.draftNumber));
        const card={id:`${team.code}-${season}-${playerId}`,playerId,name,season,teamCode:team.code,teamName:team.teamName,gp:n(first(row,'GP')),mpg:round(first(row,'MIN')),ppg:round(first(row,'PTS')),rpg:round(first(row,'REB')),apg:round(first(row,'AST')),spg:round(first(row,'STL')),bpg:round(first(row,'BLK')),tov:round(first(row,'TOV')),fgPct:round(first(row,'FG_PCT'),3),threePct:round(first(row,'FG3_PCT'),3),ftPct:round(first(row,'FT_PCT'),3),plusMinus:round(first(row,'PLUS_MINUS')),age:round(first(row,'AGE'),1),heightInches,height:heightString(heightInches),weightLbs:n(first(seasonBio,'PLAYER_WEIGHT'),n(staticBio.weightLbs))||null,college:first(seasonBio,'COLLEGE')||null,country:first(seasonBio,'COUNTRY')||null,draftYear:n(first(seasonBio,'DRAFT_YEAR'),n(staticBio.draftYear))||null,draftRound:n(first(seasonBio,'DRAFT_ROUND'),n(staticBio.draftRound))||null,draftPick:draftPick||null,nbaGames:n(career.nbaGames),accolades:[...(awards.get(`${season}|${norm(name)}`)||[])],headshotUrl:`https://ak-static.cms.nba.com/wp-content/uploads/headshots/gleague/260x190/${playerId}.png`,sourceLabel:'NBA G League official statistics'};
        card.positions=inferPositions({heightInches,nbaPositions:staticBio.positions,ast:card.apg,reb:card.rpg,blk:card.bpg});
        cards.push(card);seasonCount++;
      }
    }
    seasonCoverage.push({season,status:seasonCount?'ok':'missing',teams:mappedTeams.length,cards:seasonCount});
    console.log(`Season ${season}: ${mappedTeams.length} mapped teams, ${seasonCount} cards`);
  }
  for(const season of SEASONS) {
    const pool=cards.filter(c=>c.season===season&&c.gp>=10);
    for(const [field,label] of [['ppg','G League scoring leader'],['rpg','G League rebounding leader'],['apg','G League assists leader']]) {
      if(!pool.length)continue;const max=Math.max(...pool.map(c=>c[field]));for(const c of pool.filter(c=>c[field]===max))if(!c.accolades.includes(label))c.accolades.push(label);
    }
  }
  const careerG=new Map();for(const c of cards)careerG.set(c.playerId,(careerG.get(c.playerId)||0)+c.gp);
  for(const c of cards){c.gleagueCareerGames=careerG.get(c.playerId)||c.gp;c.overall=rating(c,c.gleagueCareerGames);c.tier=tierFor(c.overall);}
  cards.sort((a,b)=>a.teamCode.localeCompare(b.teamCode)||b.season.localeCompare(a.season)||b.overall-a.overall||a.name.localeCompare(b.name));
  const counts=Object.fromEntries(TEAM_CODES.map(code=>[code,cards.filter(c=>c.teamCode===code).length])), missingTeams=TEAM_CODES.filter(code=>!counts[code]), missingSeasons=seasonCoverage.filter(s=>s.status!=='ok').map(s=>s.season), generatedAt=new Date().toISOString(), complete=missingTeams.length===0&&missingSeasons.length===0;
  const payload={generatedAt,complete,source:'NBA G League official historical player statistics; NBA career games through June 13, 2026; Basketball-Reference and NBA G League award histories',dataCutoff:'2026-06-13',seasons:SEASONS,missingSeasons,missingTeams,counts,seasonCoverage,cards};
  fs.writeFileSync(OUT,`window.GLEAGUE_DATA=${JSON.stringify(payload)};\n`);
  fs.writeFileSync(RAW_OUT,JSON.stringify({generatedAt,complete,totalCards:cards.length,counts,missingTeams,missingSeasons,seasonCoverage},null,2));
  console.log(`Wrote ${cards.length} cards. Complete=${complete}. Missing teams=${missingTeams.join(',')||'none'}; missing seasons=${missingSeasons.join(',')||'none'}`);
  if(cards.length<500) process.exitCode=2;
}
main().catch(error=>{console.error(error);process.exit(1)});
