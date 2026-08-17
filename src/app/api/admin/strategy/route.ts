import { isOwnerAuthorized, ownerUnauthorized } from "@/lib/ownerAuth";
import { setPlayerStrategy, STRATEGY_STATUSES, type StrategyStatus } from "@/lib/strategy";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

export async function POST(request:Request){
  if(!isOwnerAuthorized(request))return ownerUnauthorized();
  const body=await request.json().catch(()=>null) as {playerId?:unknown;status?:unknown}|null;
  const playerId=typeof body?.playerId==="string"?body.playerId:"";
  const rawStatus=body?.status;
  const status=rawStatus===null||rawStatus===""?null:typeof rawStatus==="string"&&STRATEGY_STATUSES.includes(rawStatus as StrategyStatus)?rawStatus as StrategyStatus:undefined;
  if(!playerId||status===undefined)return Response.json({error:"Invalid player or strategy status."},{status:400});
  const owned=await prisma.ownershipInterval.findFirst({where:{playerId,validTo:null,manager:{isPrimaryTeam:true,league:{sleeperId:SLEEPER_LEAGUE_ID}}},select:{id:true}});
  if(!owned)return Response.json({error:"Player is not currently on Orlando."},{status:400});
  await setPlayerStrategy(playerId,status);
  return Response.json({ok:true,playerId,status});
}
