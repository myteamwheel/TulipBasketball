import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getAllCurrentRosterEntries, getAllManagers, getPrimaryManager } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations, getLatestSlotMap } from "@/lib/teamMetrics";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";
import { getLatestMarketSourceStatuses } from "@/lib/marketSources";
import { fetchFreshDraftPickMarketValues } from "@/lib/pickMarket";
import { calculatePackageTradeValue } from "@/lib/tradeValue";
import { getTradedPicks } from "@/lib/sleeper";
import { blocksOutgoing, ensureInitialOrlandoStrategyDefaults, getPlayerStrategies, outgoingAdjustment, targetAdjustment, type StrategyStatus } from "@/lib/strategy";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type Position = (typeof POSITIONS)[number];
export type TradeFinderAsset = { id: string; assetType: "player" | "pick"; name: string; position: string; value: number; slot: string; };
export type TradeCalculatorAsset = TradeFinderAsset & { managerId: string; managerName: string; nflTeam: string | null; consensusValue: number | null; isStale: boolean; };
export type TradeFinderOffer = { give: TradeFinderAsset[]; get: TradeFinderAsset[]; giveRawValue: number; getRawValue: number; giveAdjustedValue: number; getAdjustedValue: number; rawEdge: number; adjustedEdge: number; valueBalance: number; packageQuality: "STRONG" | "WORKABLE"; ownerNeedMatch: string[]; };
export type TradeFinderTarget = { id: string; name: string; position: string; nflTeam: string | null; ownerName: string; ownerId: string; value: number; consensusValue: number | null; change30d: number | null; change30dPercent: number | null; fitScore: number; confidence: "HIGH" | "MEDIUM" | "LOW"; tags: string[]; ownerNeeds: Position[]; why: string; offers: TradeFinderOffer[]; };
export type TradeFinderData = { targets: TradeFinderTarget[]; orlandoNeeds: { position: string; leagueRank: number; note: string }[]; protectedNames: string[]; playerTradeChipCount: number; pickTradeChipCount: number; primaryManagerId: string; primaryManagerName: string; managers: { id: string; name: string }[]; calculatorAssets: TradeCalculatorAsset[]; strategies: Record<string, StrategyStatus>; ktcStale: boolean; ktcObservedAt: string | null; pickMarketAvailable: boolean; };
type LiveAsset = TradeCalculatorAsset & { change30d: number | null; change30dPercent: number | null; };

function managerPositionRank(managerId: string, position: Position, valuations: Awaited<ReturnType<typeof computeAllTeamValuations>>): number {
  const ranked = [...valuations].sort((a, b) => (b.positionalValue[position] ?? 0) - (a.positionalValue[position] ?? 0));
  const index = ranked.findIndex((value) => value.managerId === managerId);
  return index >= 0 ? index + 1 : ranked.length;
}
function rankedPositionNeeds(managerId: string, valuations: Awaited<ReturnType<typeof computeAllTeamValuations>>) { return POSITIONS.map((position) => ({ position, rank: managerPositionRank(managerId, position, valuations) })).sort((a, b) => b.rank - a.rank || a.position.localeCompare(b.position)); }
function needsForManager(managerId: string, valuations: Awaited<ReturnType<typeof computeAllTeamValuations>>): Position[] { return rankedPositionNeeds(managerId, valuations).slice(0, 2).map((row) => row.position); }
function combinations(chips: LiveAsset[]): LiveAsset[][] { const pool = chips.slice(0, 30); const result: LiveAsset[][] = pool.map((chip) => [chip]); for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) result.push([pool[i], pool[j]]); return result; }

function offerCandidates(target: LiveAsset, chips: LiveAsset[], ownerNeeds: Position[], strategies: Map<string, StrategyStatus>): TradeFinderOffer[] {
  const targetPackage = calculatePackageTradeValue([target]);
  const packages = combinations(chips).map((give) => {
    const givePackage = calculatePackageTradeValue(give);
    const ratio = targetPackage.adjustedValue > 0 ? givePackage.adjustedValue / targetPackage.adjustedValue : 99;
    const needMatches = [...new Set(give.map((asset) => asset.position).filter((position) => ownerNeeds.includes(position as Position)))];
    const containsPick = give.some((asset) => asset.assetType === "pick");
    const strategyBonus = give.reduce((sum, asset) => sum + outgoingAdjustment(strategies.get(asset.id)), 0);
    const rankScore = Math.abs(givePackage.adjustedValue - targetPackage.adjustedValue) - needMatches.length * 425 - (containsPick ? 90 : 0) + strategyBonus;
    return { give, givePackage, targetPackage, ownerNeedMatch: needMatches, ratio, rankScore };
  }).filter((candidate) => candidate.ratio >= 0.92 && candidate.ratio <= 1.15).sort((a, b) => a.rankScore - b.rankScore);
  const selected: typeof packages = [];
  for (const candidate of packages) {
    const key = candidate.give.map((asset) => asset.id).sort().join(":");
    if (selected.some((row) => row.give.map((asset) => asset.id).sort().join(":") === key)) continue;
    if (selected.length === 1) { const firstHasPick = selected[0].give.some((asset) => asset.assetType === "pick"); const candidateHasPick = candidate.give.some((asset) => asset.assetType === "pick"); if (selected[0].give.length === candidate.give.length && firstHasPick === candidateHasPick) continue; }
    selected.push(candidate); if (selected.length === 2) break;
  }
  return selected.map(({ give, givePackage, targetPackage, ownerNeedMatch, ratio }) => ({ give: give.map(({ id, assetType, name, position, value, slot }) => ({ id, assetType, name, position, value, slot })), get: [{ id: target.id, assetType: "player", name: target.name, position: target.position, value: target.value, slot: target.slot }], giveRawValue: givePackage.rawValue, getRawValue: targetPackage.rawValue, giveAdjustedValue: givePackage.adjustedValue, getAdjustedValue: targetPackage.adjustedValue, rawEdge: targetPackage.rawValue - givePackage.rawValue, adjustedEdge: targetPackage.adjustedValue - givePackage.adjustedValue, valueBalance: Math.min(ratio, 1 / ratio) * 100, packageQuality: ratio >= 0.96 && ratio <= 1.08 ? "STRONG" : "WORKABLE", ownerNeedMatch }));
}
function dataConfidence(target: LiveAsset, offers: TradeFinderOffer[], ktcStale: boolean): "HIGH" | "MEDIUM" | "LOW" { if (ktcStale || target.isStale || !offers.length) return "LOW"; if (target.consensusValue !== null && target.change30dPercent !== null) return "HIGH"; if (target.consensusValue !== null || target.change30dPercent !== null) return "MEDIUM"; return "LOW"; }
function ordinalRound(round: number): string { return round === 1 ? "1st" : round === 2 ? "2nd" : round === 3 ? "3rd" : `${round}th`; }
function neutralPickValue(market: Awaited<ReturnType<typeof fetchFreshDraftPickMarketValues>>, season: number, round: number): number | null { const matching = market.filter((pick) => Number(pick.season) === season && pick.round === round); if (!matching.length) return null; const generic = matching.find((pick) => pick.slot === null); return generic?.value ?? Math.round(matching.reduce((sum, pick) => sum + pick.value, 0) / matching.length); }

export async function buildTradeFinderData(): Promise<TradeFinderData | null> {
  const primary = await getPrimaryManager(); if (!primary) return null;
  const entries = await getAllCurrentRosterEntries(); const playerIds = entries.map((entry) => entry.playerId);
  const [market, mix, valuations, slotMap, managers, tradedPicks, pickMarket, league, marketStatuses] = await Promise.all([computeMarketDataForPlayers(playerIds), getFreshCurrentMarketMix(playerIds), computeAllTeamValuations(), getLatestSlotMap(), getAllManagers(), getTradedPicks(SLEEPER_LEAGUE_ID).catch(() => []), fetchFreshDraftPickMarketValues().catch(() => []), prisma.league.findFirst({ where: { sleeperId: SLEEPER_LEAGUE_ID }, select: { settings: true, season: true } }), getLatestMarketSourceStatuses()]);
  const primaryEntries = entries.filter((entry) => entry.managerId === primary.id); await ensureInitialOrlandoStrategyDefaults(primary.id, primaryEntries); const strategies = await getPlayerStrategies(playerIds);
  const assets: LiveAsset[] = entries.map((entry) => { const playerMarket = market.get(entry.playerId)!; const currentMix = mix.get(entry.playerId); return { id: entry.player.id, assetType: "player" as const, name: entry.player.fullName, position: entry.player.position, value: playerMarket.currentValue ?? 0, slot: slotMap.get(`${entry.managerId}:${entry.playerId}`) ?? "BENCH", managerId: entry.managerId, managerName: entry.manager.teamName ?? entry.manager.displayName, nflTeam: entry.player.nflTeam, consensusValue: currentMix?.consensusValue ?? null, isStale: playerMarket.isStale, change30d: playerMarket.change30d?.points ?? null, change30dPercent: playerMarket.change30d?.percent ?? null }; }).filter((asset) => asset.value > 0);
  let draftRounds = 4; try { const settings = league?.settings ? JSON.parse(league.settings) : null; const parsed = Number(settings?.settings?.draft_rounds); if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 10) draftRounds = parsed; } catch {}
  const leagueSeason = Number(league?.season ?? new Date().getUTCFullYear()); const futureSeasons = [...new Set(pickMarket.map((pick) => Number(pick.season)).filter((year) => Number.isFinite(year) && year >= leagueSeason))].sort((a,b)=>a-b).slice(0,4);
  const managerByRosterId = new Map(managers.map((manager) => [manager.sleeperRosterId, manager])); const allPickAssets: LiveAsset[] = [];
  for (const season of futureSeasons) for (let round = 1; round <= draftRounds; round++) { const value = neutralPickValue(pickMarket, season, round); if (!value || value < 200) continue; for (const origin of managers) { const moved = tradedPicks.find((pick) => Number(pick.season) === season && pick.round === round && pick.roster_id === origin.sleeperRosterId); const currentOwner = managerByRosterId.get(moved?.owner_id ?? origin.sleeperRosterId); if (!currentOwner) continue; allPickAssets.push({ id: `pick:${season}:${round}:${origin.sleeperRosterId}`, assetType: "pick", name: `${season} ${ordinalRound(round)} · ${origin.teamName ?? origin.displayName} original`, position: "PICK", value, slot: "PICK", managerId: currentOwner.id, managerName: currentOwner.teamName ?? currentOwner.displayName, nflTeam: null, consensusValue: null, isStale: false, change30d: null, change30dPercent: null }); } }
  const primaryPlayers = assets.filter((asset) => asset.managerId === primary.id).sort((a,b)=>b.value-a.value); const protectedPlayers = primaryPlayers.filter((asset) => blocksOutgoing(strategies.get(asset.id)));
  const playerChips = primaryPlayers.filter((asset) => !asset.isStale && !blocksOutgoing(strategies.get(asset.id)) && asset.value >= 500).sort((a,b)=>(a.value + outgoingAdjustment(strategies.get(a.id))) - (b.value + outgoingAdjustment(strategies.get(b.id))));
  const pickChips = allPickAssets.filter((asset)=>asset.managerId===primary.id); const chips=[...playerChips,...pickChips].sort((a,b)=>b.value-a.value);
  const orlandoNeedRanks = rankedPositionNeeds(primary.id, valuations); const orlandoNeeds = orlandoNeedRanks.slice(0,3).map(({position,rank})=>({position,leagueRank:rank,note:`#${rank} of ${valuations.length} in current ${position} player capital`}));
  const ktcStale=marketStatuses.KTC.stale;
  const targets = ktcStale ? [] : assets.filter((asset)=>asset.managerId!==primary.id && !asset.isStale).filter((asset)=>POSITIONS.includes(asset.position as Position)&&asset.value>=1700).filter((asset)=>strategies.get(asset.id)!=="AVOID").map((target)=>{
    const position=target.position as Position; const ownerNeeds=needsForManager(target.managerId,valuations); const ownerSamePosition=assets.filter((asset)=>asset.managerId===target.managerId&&asset.position===position&&!asset.isStale&&asset.value>=1800).length; const ownerHasSurplus=(position==="QB"&&ownerSamePosition>=3)||((position==="RB"||position==="WR")&&ownerSamePosition>=4)||(position==="TE"&&ownerSamePosition>=3); const offers=offerCandidates(target,chips,ownerNeeds,strategies); if(!offers.length)return null;
    const tags:string[]=[]; const rank=managerPositionRank(primary.id,position,valuations); let score=35+targetAdjustment(strategies.get(target.id)); if(strategies.get(target.id)==="TARGET")tags.push("Saved target"); score+=Math.max(0,Math.min(24,(rank-3)*3)); if(rank>=8)tags.push(`Orlando #${rank} ${position}`); if(target.value>=2500&&target.value<=6500)score+=8; else if(target.value<=7600)score+=4; if(target.change30dPercent!==null&&target.change30dPercent<0){score+=Math.min(6,Math.abs(target.change30dPercent)/2.5);tags.push("Valid 30d dip");} if(target.consensusValue!==null&&target.consensusValue>target.value*1.04){score+=5;tags.push("Trusted market > KTC");} if(ownerHasSurplus){score+=8;tags.push(`Owner has ${position} depth`);} const best=offers[0]; if(best.packageQuality==="STRONG")score+=10; if(best.ownerNeedMatch.length){score+=7;tags.push(`Package fits ${target.managerName}`);} if(offers.some((offer)=>offer.give.some((asset)=>asset.assetType==="pick")))tags.push("Pick structure available"); const fitScore=Math.max(1,Math.min(92,Math.round(score))); const confidence=dataConfidence(target,offers,ktcStale); const movementText=target.change30dPercent===null?"No decision-grade 30-day trend is available":`KTC is ${target.change30dPercent>=0?"up":"down"} ${Math.abs(target.change30dPercent).toFixed(1)}% over a valid 30-day window`;
    return {id:target.id,name:target.name,position:target.position,nflTeam:target.nflTeam,ownerName:target.managerName,ownerId:target.managerId,value:target.value,consensusValue:target.consensusValue,change30d:target.change30d,change30dPercent:target.change30dPercent,fitScore,confidence,tags:[...new Set(tags)].slice(0,5),ownerNeeds,why:`${position} ranks #${rank} for Orlando by current player capital. ${target.managerName}'s weakest value groups include ${ownerNeeds.join(" / ")}. ${movementText}.`,offers} satisfies TradeFinderTarget;
  }).filter((target): target is TradeFinderTarget=>target!==null).sort((a,b)=>b.fitScore-a.fitScore||b.value-a.value).slice(0,30);
  const calculatorAssets:TradeCalculatorAsset[]=[...assets,...allPickAssets].filter((asset)=>asset.assetType==="pick"||!asset.isStale).map(({change30d:_a,change30dPercent:_b,...asset})=>asset).sort((a,b)=>a.managerName.localeCompare(b.managerName)||b.value-a.value);
  return {targets,orlandoNeeds,protectedNames:protectedPlayers.map((asset)=>asset.name),playerTradeChipCount:playerChips.length,pickTradeChipCount:pickChips.length,primaryManagerId:primary.id,primaryManagerName:primary.teamName??primary.displayName,managers:managers.map((manager)=>({id:manager.id,name:manager.teamName??manager.displayName})),calculatorAssets,strategies:Object.fromEntries(strategies),ktcStale,ktcObservedAt:marketStatuses.KTC.observedAt,pickMarketAvailable:pickMarket.length>0};
}
