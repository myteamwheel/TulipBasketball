// Read-only Sleeper API client. Sleeper's public REST API requires no auth key.
// This module never mutates league state — GET requests only.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { LEAGUE_TEAM_COUNT } from "@/lib/config";

const BASE = "https://api.sleeper.app/v1";
const PLAYER_CACHE_PATH = path.join(os.tmpdir(), "dynasty-boys-sleeper-players.json");
const PLAYER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let playerCatalogPromise: Promise<Record<string, SleeperPlayer>> | null = null;
let playerCatalogExpiresAt = 0;

export interface SleeperLeague { total_rosters?:number; league_id:string; name:string; season:string; status:string; roster_positions:string[]; scoring_settings:Record<string,number>; settings:Record<string,number|string>; previous_league_id:string|null; }
export interface SleeperUser { user_id:string; display_name:string; metadata:{team_name?:string}|null; }
export interface SleeperRoster { roster_id:number; owner_id:string|null; players:string[]|null; starters:string[]|null; reserve:string[]|null; taxi:string[]|null; settings?:Record<string,number>; }
export interface SleeperPlayer { player_id:string; full_name?:string; first_name?:string; last_name?:string; position?:string; team?:string|null; status?:string|null; injury_status?:string|null; active?:boolean; }
export interface SleeperTransaction { transaction_id:string; type:string; status:string; status_updated:number; roster_ids:number[]; adds:Record<string,number>|null; drops:Record<string,number>|null; draft_picks:unknown[]; waiver_budget:unknown[]; created:number; }
export interface SleeperTradedPick { season:string; round:number; roster_id:number; previous_owner_id:number; owner_id:number; }
export interface SleeperNflState { week:number; season:string; season_type:string; }
export interface SleeperMatchup { roster_id:number; matchup_id:number|null; points:number; custom_points:number|null; starters:string[]|null; players:string[]|null; }

export function validateSleeperRosterSnapshot(league: SleeperLeague, users: SleeperUser[], rosters: SleeperRoster[]): void {
  const expected = league.total_rosters ?? LEAGUE_TEAM_COUNT;
  if (!Number.isInteger(expected) || expected < 1 || !Array.isArray(users) || !users.length || !Array.isArray(rosters) || rosters.length !== expected ||
      rosters.some(roster => !roster || !Number.isInteger(roster.roster_id) || roster.roster_id <= 0 || (roster.players != null && !Array.isArray(roster.players))) ||
      new Set(rosters.map(roster => roster.roster_id)).size !== rosters.length) {
    throw new Error("Sleeper returned an incomplete roster or manager list; existing ownership was preserved.");
  }
  const players = rosters.flatMap(roster => roster.players ?? []);
  if (players.some(player => typeof player !== "string" || !player) || new Set(players).size !== players.length) {
    throw new Error("Sleeper returned conflicting player ownership; existing ownership was preserved.");
  }
}

async function getJson<T>(url:string):Promise<T>{const res=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(20_000),cache:"no-store"});if(!res.ok)throw new Error(`Sleeper API request failed (${res.status} ${res.statusText}): ${url}`);return(await res.json())as T;}
export async function getLeague(leagueId:string){return getJson<SleeperLeague>(`${BASE}/league/${leagueId}`)}
export async function getUsers(leagueId:string){return getJson<SleeperUser[]>(`${BASE}/league/${leagueId}/users`)}
export async function getRosters(leagueId:string){return getJson<SleeperRoster[]>(`${BASE}/league/${leagueId}/rosters`)}
export async function getNflState(){return getJson<SleeperNflState>(`${BASE}/state/nfl`)}
export async function getTradedPicks(leagueId:string){return getJson<SleeperTradedPick[]>(`${BASE}/league/${leagueId}/traded_picks`)}
export async function getMatchups(leagueId:string,week:number){return getJson<SleeperMatchup[]>(`${BASE}/league/${leagueId}/matchups/${week}`)}
export async function getAllTransactions(leagueId: string, throughWeek: number): Promise<SleeperTransaction[]> {
  if (!Number.isInteger(throughWeek) || throughWeek < 1 || throughWeek > 18) throw new Error("Invalid Sleeper transaction week range.");
  const weeks = Array.from({ length: throughWeek }, (_, index) => index + 1);
  const results = await Promise.all(weeks.map(async (week) => {
    try {
      const rows = await getJson<SleeperTransaction[]>(`${BASE}/league/${leagueId}/transactions/${week}`);
      if (!Array.isArray(rows)) throw new Error("Transaction feed is not an array.");
      return rows;
    } catch (error) {
      throw new Error(`Sleeper transactions week ${week} failed; the ledger was not refreshed. ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  return [...new Map(results.flat().map(row => [row.transaction_id, row])).values()];
}
export async function getPlayerCatalog():Promise<Record<string,SleeperPlayer>>{
  if(playerCatalogPromise&&Date.now()<playerCatalogExpiresAt)return playerCatalogPromise;
  const request=(async()=>{
    try{
      const stat=await fs.stat(PLAYER_CACHE_PATH);
      if(Date.now()-stat.mtimeMs<PLAYER_CACHE_MAX_AGE_MS){
        const cached=await fs.readFile(PLAYER_CACHE_PATH,"utf-8");
        const parsed:unknown=JSON.parse(cached);
        if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))return parsed as Record<string,SleeperPlayer>;
      }
    }catch{}
    const catalog=await getJson<Record<string,SleeperPlayer>>(`${BASE}/players/nfl`);
    try{
      await fs.mkdir(path.dirname(PLAYER_CACHE_PATH),{recursive:true});
      await fs.writeFile(PLAYER_CACHE_PATH,JSON.stringify(catalog));
    }catch{}
    return catalog;
  })();
  playerCatalogPromise=request;
  playerCatalogExpiresAt=Date.now()+PLAYER_CACHE_MAX_AGE_MS;
  void request.catch(()=>{
    if(playerCatalogPromise===request){
      playerCatalogPromise=null;
      playerCatalogExpiresAt=0;
    }
  });
  return request;
}
