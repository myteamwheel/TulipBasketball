import { AuditNotFoundError, isAuditSelector } from "@/lib/auditSelection";
import { buildCompleteDataWorkbook } from "@/lib/exportWorkbook";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!isAuditSelector(date)) return Response.json({ error: "Invalid audit snapshot" }, { status: 400 });
  try {
  const workbook = await buildCompleteDataWorkbook({ auditDate: date, auditOnly: true });
  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="orlando-oswalds-audit-${date ?? "latest"}.xlsx"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
  } catch (error) {
    if (error instanceof AuditNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
