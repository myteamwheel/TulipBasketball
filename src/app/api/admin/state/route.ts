import { isOwnerAuthorized, ownerUnauthorized } from "@/lib/ownerAuth";
import { getCurrentRoster, getPrimaryManager } from "@/lib/queries";
import { getPlayerStrategies } from "@/lib/strategy";

export const dynamic="force-dynamic";
export async function GET(request:Request){
  if(!isOwnerAuthorized(request))return ownerUnauthorized();
  const manager=await getPrimaryManager();
  if(!manager)return Response.json({error:"Primary team unavailable."},{status:503});
  const roster=await getCurrentRoster(manager.id);
  const strategies=await getPlayerStrategies(roster.map(player=>player.id));
  return Response.json({teamName:manager.teamName??"Orlando Oswalds",players:roster.map(player=>({id:player.id,name:player.fullName,position:player.position,nflTeam:player.nflTeam,status:strategies.get(player.id)??null})).sort((a,b)=>a.position.localeCompare(b.position)||a.name.localeCompare(b.name))});
}
