import { AuditNotFoundError } from "@/lib/auditSelection";
import { getFullAudit } from "@/lib/fullAudit";
import { prisma } from "@/lib/prisma";
import { AUDIT_FILES } from "@/lib/fullAuditFormat";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("run") ?? undefined;
  if (id && id !== "reference" && !/^[a-f0-9-]{36}$/i.test(id)) return Response.json({ error: "Invalid snapshot" }, { status: 400 });
  const name = params.get("file");
  if (name && !AUDIT_FILES.includes(name as typeof AUDIT_FILES[number])) return Response.json({ error: "Unknown file" }, { status: 400 });
  let audit;
  try { audit = await getFullAudit(id); }
  catch (error) {
    if (error instanceof AuditNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
  if (!name) return Response.json({ id: audit.id, generatedAt: audit.data.generatedAt, published: audit.published, tables: audit.data.tables.map(table => ({ name: table.name, rows: table.rows.length })), changes: audit.data.changes });
  if (!audit.published) {
    const paths: Record<string, string> = { "tables.json.gz": "source-tables.json.gz", "Dynasty-Bois-Data.xlsx": "dynasty-bois-source-audit.xlsx", "Dynasty-Bois-Report.pdf": "dynasty-bois-source-audit.pdf" };
    return Response.redirect(new URL(`/audit/${paths[name]}`, request.url));
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ body: Uint8Array }>>(`SELECT body FROM "FullAuditFile" WHERE "bundleId"=$1 AND name=$2`, audit.id, name);
  if (!rows[0]) return Response.json({ error: "File unavailable" }, { status: 404 });
  const type = name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/gzip";
  const inline = params.get("view") === "inline" && name.endsWith(".pdf");
  return new Response(new Uint8Array(rows[0].body), { headers: { "Content-Type": type, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`, "Cache-Control": "private, no-store" } });
}
