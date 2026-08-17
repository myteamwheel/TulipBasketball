import { isOwnerAuthorized, ownerUnauthorized } from "@/lib/ownerAuth";
import { isRefreshLocked, startRefresh } from "@/lib/refresh";

export async function POST(request:Request){
  if(!isOwnerAuthorized(request))return ownerUnauthorized();
  if(await isRefreshLocked())return Response.json({error:"A refresh is already running."},{status:409});
  try{return Response.json(await startRefresh(),{status:202});}catch(error){return Response.json({error:error instanceof Error?error.message:String(error)},{status:500});}
}
