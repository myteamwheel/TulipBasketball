import { AuditNotFoundError, isAuditSelector } from "@/lib/auditSelection";
import { getAuditDashboardData } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!isAuditSelector(date)) return Response.json({ error: "Invalid audit snapshot" }, { status: 400 });
  try {
  const result = await getAuditDashboardData(date);
  return Response.json(result, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
  } catch (error) {
    if (error instanceof AuditNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
