import {
  getPredictivePlayerModels,
  type PredictivePlayerModel,
  type ValueForecast,
} from "@/lib/predictive";

const MIN_POSITIONAL_FOOTBALL_PEERS = 8;
const MAX_PRODUCTION_SEASON_AGE = 1;

function round(value: number) { return Math.round(value); }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function quantile(values: number[], q: number) { const xs=[...values].filter(Number.isFinite).sort((a,b)=>a-b); if(!xs.length)return 0; if(xs.length===1)return xs[0]; const p=clamp(q,0,1)*(xs.length-1),lo=Math.floor(p),hi=Math.ceil(p),f=p-lo; return xs[lo]+(xs[hi]-xs[lo])*f; }
function percentile(value:number|null,values:number[]){if(value===null||!Number.isFinite(value))return .5;const clean=values.filter(Number.isFinite);if(!clean.length)return .5;const below=clean.filter(peer=>peer<value).length,equal=clean.filter(peer=>peer===value).length;return clamp((below+equal*.5)/clean.length,.02,.98);}
function ageScore(position:string,age:number|null){if(age===null)return .5;if(position==="QB"){if(age<=24)return .9;if(age<=30)return 1;if(age<=33)return .86;if(age<=36)return .62;return .34;}if(position==="RB"){if(age<=22)return 1;if(age<=23)return .95;if(age<=24)return .85;if(age<=25)return .7;if(age<=26)return .55;if(age<=27)return .38;if(age<=28)return .22;return .1;}if(position==="WR"){if(age<=22)return .95;if(age<=25)return 1;if(age<=27)return .9;if(age<=28)return .75;if(age<=29)return .58;if(age<=30)return .4;return .2;}if(position==="TE"){if(age<=23)return .8;if(age<=27)return 1;if(age<=29)return .9;if(age<=30)return .7;if(age<=31)return .55;return .3;}return .5;}
function draftScore(roundValue:number|null,yearsSinceDraft:number|null){let base=.18;if(roundValue===1)base=1;else if(roundValue===2)base=.84;else if(roundValue===3)base=.68;else if(roundValue===4)base=.54;else if(roundValue===5)base=.42;else if(roundValue===6)base=.33;else if(roundValue===7)base=.26;if(yearsSinceDraft===null)return base;let weight=.2;if(yearsSinceDraft<=1)weight=1;else if(yearsSinceDraft===2)weight=.8;else if(yearsSinceDraft===3)weight=.6;else if(yearsSinceDraft<=5)weight=.4;return .5+(base-.5)*weight;}
function marketImpliedPpg(position:string,value:number){const x=Math.pow(clamp(value/10000,0,1),.76);if(position==="QB")return 10.5+13*x;if(position==="RB")return 3+14*x;if(position==="WR")return 3+14.5*x;if(position==="TE")return 2.5+12.5*x;return 3+10*x;}
function recenterForecast(forecast:ValueForecast,mean:number):ValueForecast{const oldMean=Math.max(1,forecast.mean),lowRatio=Math.max(.05,forecast.low/oldMean),highRatio=Math.max(1,forecast.high/oldMean);return{mean:round(mean),low:round(Math.max(50,mean*lowRatio)),high:round(Math.min(10000,mean*highRatio))};}
function neutralMarketModel(row:PredictivePlayerModel){const consensus=row.consensusValue??row.currentValue,modelValue=round(row.currentValue*.85+consensus*.15),modelEdge=modelValue-row.currentValue,modelEdgePercent=row.currentValue>0?modelEdge/row.currentValue*100:0;return{modelValue,modelEdge,modelEdgePercent};}

export function isDecisionGradeProductionSeason(latestSeason:number|null,games:number,currentYear=new Date().getUTCFullYear()){return latestSeason!==null&&games>=3&&latestSeason>=currentYear-MAX_PRODUCTION_SEASON_AGE;}

type RecentPeerPool={ppg:number[];opportunity:number[];market:number[]};

/**
 * Applies evidence gates to the raw predictive model. Decision-grade players
 * are re-percentiled against recent decision-grade peers only, so a stale
 * season cannot influence another player's current production/usage benchmark.
 * The raw model does not expose the underlying efficiency rate (only its
 * already-percentiled score), so efficiency is conservatively neutralized in
 * this clean-peer recalculation instead of carrying a percentile built from a
 * contaminated peer population.
 */
export async function getDecisionGradePredictiveModels(requestedIds?:string[]):Promise<Map<string,PredictivePlayerModel>>{
  const models=await getPredictivePlayerModels(requestedIds),currentYear=new Date().getUTCFullYear(),peerCounts=new Map<string,number>(),recentPeers=new Map<string,RecentPeerPool>();
  for(const row of models.values()){
    if(!isDecisionGradeProductionSeason(row.latestSeason,row.games,currentYear))continue;
    peerCounts.set(row.position,(peerCounts.get(row.position)??0)+1);
    const pool=recentPeers.get(row.position)??{ppg:[],opportunity:[],market:[]};
    if(row.fantasyPpg!==null&&Number.isFinite(row.fantasyPpg))pool.ppg.push(row.fantasyPpg);
    if(row.opportunityPerGame!==null&&Number.isFinite(row.opportunityPerGame))pool.opportunity.push(row.opportunityPerGame);
    pool.market.push(row.currentValue);recentPeers.set(row.position,pool);
  }
  const guarded=new Map<string,PredictivePlayerModel>();
  for(const[playerId,row]of models){
    const hasProfileEvidence=row.age!==null||row.draftYear!==null||row.draftRound!==null,hasProduction=row.games>=3,hasRecentProduction=isDecisionGradeProductionSeason(row.latestSeason,row.games,currentYear),productionIsStale=hasProduction&&!hasRecentProduction,positionalPeerCount=peerCounts.get(row.position)??0,peerSampleAdequate=positionalPeerCount>=MIN_POSITIONAL_FOOTBALL_PEERS;
    let next=row;
    if(hasRecentProduction&&peerSampleAdequate){
      const pool=recentPeers.get(row.position);
      if(pool){
        const productionScore=percentile(row.fantasyPpg,pool.ppg),usageScore=percentile(row.opportunityPerGame,pool.opportunity),efficiencyScore=.5,yearsSinceDraft=row.draftYear===null?null:Math.max(0,currentYear-row.draftYear),fundamentalScore=clamp(productionScore*.30+usageScore*.25+efficiencyScore*.10+ageScore(row.position,row.age)*.20+draftScore(row.draftRound,yearsSinceDraft)*.15,.03,.97),fundamentalValue=round(clamp(quantile(pool.market,fundamentalScore),50,10000)),consensus=row.consensusValue??row.currentValue,modelValue=round(clamp(row.currentValue*.45+consensus*.15+fundamentalValue*.40,50,10000)),modelEdge=modelValue-row.currentValue,modelEdgePercent=row.currentValue>0?modelEdge/row.currentValue*100:0;
        next={...row,productionScore,usageScore,efficiencyScore,fundamentalScore,fundamentalValue,modelValue,modelEdge,modelEdgePercent,forecast30d:recenterForecast(row.forecast30d,modelValue),forecastRos:recenterForecast(row.forecastRos,modelValue),forecast1y:recenterForecast(row.forecast1y,modelValue),forecast3y:recenterForecast(row.forecast3y,modelValue),reasons:[`Football peer value is benchmarked against ${positionalPeerCount} recent decision-grade ${row.position} peers; stale seasons are excluded from the comparison population.`,`Efficiency contribution is neutral in the clean-peer valuation because the underlying efficiency rate is not exposed by the raw model; an already-percentiled contaminated score is not reused.`,...row.reasons.filter(reason=>!reason.startsWith("Football-only peer value"))].slice(0,4)};
      }
    }
    if(!hasProfileEvidence&&!hasProduction){
      const{modelValue,modelEdge,modelEdgePercent}=neutralMarketModel(row);next={...row,fundamentalValue:row.currentValue,fundamentalScore:.5,productionScore:.5,usageScore:.5,efficiencyScore:.5,modelValue,modelEdge,modelEdgePercent,forecast30d:recenterForecast(row.forecast30d,modelValue),forecastRos:recenterForecast(row.forecastRos,modelValue),forecast1y:recenterForecast(row.forecast1y,modelValue),forecast3y:recenterForecast(row.forecast3y,modelValue),confidence:"LOW",mispricingQuadrant:"MARKET_ONLY",reasons:["Independent football value is neutral because no usable production or player profile is loaded yet; missing data is not treated as negative evidence.",...row.reasons.filter(reason=>!reason.startsWith("Football-only peer value"))].slice(0,4)};
    }
    if(productionIsStale){
      const{modelValue,modelEdge,modelEdgePercent}=neutralMarketModel(row),seasonAge=row.latestSeason===null?null:currentYear-row.latestSeason,projectedWeeklyPoints=Number(marketImpliedPpg(row.position,row.currentValue).toFixed(1));next={...next,fundamentalValue:row.currentValue,fundamentalScore:.5,productionScore:.5,usageScore:.5,efficiencyScore:.5,modelValue,modelEdge,modelEdgePercent,projectedWeeklyPoints,forecast30d:recenterForecast(next.forecast30d,modelValue),forecastRos:recenterForecast(next.forecastRos,modelValue),forecast1y:recenterForecast(next.forecast1y,modelValue),forecast3y:recenterForecast(next.forecast3y,modelValue),confidence:"LOW",mispricingQuadrant:"MARKET_ONLY",reasons:[`Independent football valuation is withheld: the latest regular-season production is from ${row.latestSeason}${seasonAge!==null?` (${seasonAge} seasons behind the current ${currentYear} season)`:""}.`,`Older production remains descriptive history, but current lineup projection reverts to a market-implied role estimate rather than carrying stale PPG into the season simulation.`,...next.reasons.filter(reason=>!reason.startsWith("Football-only peer value")&&!reason.includes("production:")&&!reason.includes("opportunity percentile"))].slice(0,4)};
    }
    if(hasRecentProduction&&!peerSampleAdequate){
      const{modelValue,modelEdge,modelEdgePercent}=neutralMarketModel(row);next={...next,fundamentalValue:row.currentValue,fundamentalScore:.5,productionScore:.5,usageScore:.5,efficiencyScore:.5,modelValue,modelEdge,modelEdgePercent,forecast30d:recenterForecast(next.forecast30d,modelValue),forecastRos:recenterForecast(next.forecastRos,modelValue),forecast1y:recenterForecast(next.forecast1y,modelValue),forecast3y:recenterForecast(next.forecast3y,modelValue),confidence:"LOW",mispricingQuadrant:"MARKET_ONLY",reasons:[`Independent football valuation is withheld: only ${positionalPeerCount} ${row.position} players currently have recent usable production; ${MIN_POSITIONAL_FOOTBALL_PEERS}+ are required for a decision-grade same-position peer sample.`,`Until that threshold is met, model value is anchored to current/trusted market evidence instead of a tiny-sample percentile.`,...next.reasons.filter(reason=>!reason.startsWith("Football-only peer value"))].slice(0,4)};
    }
    guarded.set(playerId,next);
  }
  return guarded;
}

export const DECISION_GRADE_POSITIONAL_PEER_MINIMUM=MIN_POSITIONAL_FOOTBALL_PEERS;
export const DECISION_GRADE_MAX_PRODUCTION_SEASON_AGE=MAX_PRODUCTION_SEASON_AGE;
