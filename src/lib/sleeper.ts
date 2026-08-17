// Read-only Sleeper API client. Sleeper's public REST API requires no auth key.
// This module never mutates league state — GET requests only.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = "https://api.sleeper.app/v1";
const PLAYER_CACHE_PATH = path.join(os.tmpdir(), "dynasty-boys-sleeper-players.json");
const PLAYER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface SleeperLeague { league_id:string; name:string; season:string; status:string; roster_positions:string[]; scoring_settings:Record<string,number>; settings:Record<string,number|string>; previous_league_id:string|null; }
export interface SleeperUser { user_id:string; display_name:string; metadata:{team_name?:string}|null; }
export interface SleeperRoster { roster_id:number; owner_id:string|null; players:string[]|null; starters:string[]|null; reserve:string[]|null; taxi:string[]|null; }
export interface SleeperPlayer { player_id:string; full_name?:string; first_name?:string; last_name?:string; position?:string; team?:string|null; status?:string|null; injury_status?:string|null; active?:boolean; }
export interface SleeperTransaction { transaction_id:string; type:string; status:string; status_updated:number; roster_ids:number[]; adds:Record<string,number>|null; drops:Record<string,number>|null; draft_picks:unknown[]; waiver_budget:unknown[]; created:number; }
export interface SleeperTradedPick { season:string; round:number; roster_id:number; previous_owner_id:number; owner_id:number; }
export interface SleeperNflState { week:number; season:string; season_type:string; }
export interface SleeperMatchup { roster_id:number; matchup_id:number|null; points:number; custom_points:number|null; starters:string[]|null; players:string[]|null; }

async function getJson<T>(url:string):Promise<T>{const res=await fetch(url,{headers:{Accept:"application/json"}});if(!res.ok)throw new Error(`Sleeper API request failed (${res.status} ${res.statusText}): ${url}`);return(await res.json())as T;}
export async function getLeague(leagueId:string){return getJson<SleeperLeague>(`${BASE}/league/${leagueId}`)}
export async function getUsers(leagueId:string){return getJson<SleeperUser[]>(`${BASE}/league/${leagueId}/users`)}
export async function getRosters(leagueId:string){return getJson<SleeperRoster[]>(`${BASE}/league/${leagueId}/rosters`)}
export async function getNflState(){return getJson<SleeperNflState>(`${BASE}/state/nfl`)}
export async function getTradedPicks(leagueId:string){return getJson<SleeperTradedPick[]>(`${BASE}/league/${leagueId}/traded_picks`)}
export async function getMatchups(leagueId:string,week:number){return getJson<SleeperMatchup[]>(`${BASE}/league/${leagueId}/matchups/${week}`)}
export async function getAllTransactions(leagueId:string,throughWeek:number):Promise<SleeperTransaction[]>{const weeks=Array.from({length:throughWeek},(_,i)=>i+1),results=await Promise.all(weeks.map(w=>getJson<SleeperTransaction[]>(`${BASE}/league/${leagueId}/transactions/${w}`).catch(()=>[] as SleeperTransaction[])));return results.flat();}
export async function getPlayerCatalog():Promise<Record<string,SleeperPlayer>>{try{const stat=await fs.stat(PLAYER_CACHE_PATH);if(Date.now()-stat.mtimeMs<PLAYER_CACHE_MAX_AGE_MS){const cached=await fs.readFile(PLAYER_CACHE_PATH,"utf-8");return JSON.parse(cached)}}catch{}const catalog=await getJson<Record<string,SleeperPlayer>>(`${BASE}/players/nfl`);await fs.mkdir(path.dirname(PLAYER_CACHE_PATH),{recursive:true});await fs.writeFile(PLAYER_CACHE_PATH,JSON.stringify(catalog));return catalog;}
