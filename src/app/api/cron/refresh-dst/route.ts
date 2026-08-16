import { GET as runPatch14Refresh } from "../refresh/route";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runPatch14Refresh(request);
}
