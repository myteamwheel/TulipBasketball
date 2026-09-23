import { AuditNotFoundError, isAuditSelector } from "@/lib/auditSelection";
import { buildAuditPdf } from "@/lib/auditPdf";
import { getAuditDashboardData } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!isAuditSelector(date)) return Response.json({ error: "Invalid audit snapshot" }, { status: 400 });
  try {
  const { data, snapshots } = await getAuditDashboardData(date);
  const pdf = buildAuditPdf(data, snapshots);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="orlando-oswalds-audit-${data.snapshotDate}.pdf"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
  } catch (error) {
    if (error instanceof AuditNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
