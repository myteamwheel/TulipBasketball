import { isOwnerAuthorized, ownerUnauthorized } from "@/lib/ownerAuth";
import { getRefreshRun, isRefreshLocked, startRefresh } from "@/lib/refresh";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isOwnerAuthorized(request)) return ownerUnauthorized();
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return Response.json({ error: "A refresh run ID is required." }, { status: 400 });
  const run = await getRefreshRun(runId);
  return Response.json(run ? { run } : { error: "Refresh run not found." }, {
    status: run ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request:Request){
  if(!isOwnerAuthorized(request))return ownerUnauthorized();
  if(await isRefreshLocked())return Response.json({error:"A refresh is already running."},{status:409});
  try{return Response.json(await startRefresh(),{status:202});}catch(error){return Response.json({error:error instanceof Error?error.message:String(error)},{status:500});}
}
