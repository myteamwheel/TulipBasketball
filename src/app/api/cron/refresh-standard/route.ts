import { runScheduledRefresh } from "@/lib/scheduledRefresh";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return runScheduledRefresh(request); }
