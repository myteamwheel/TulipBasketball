import { buildDynastyWorkbook } from "@/lib/exportWorkbook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const workbook = await buildDynastyWorkbook();
  const day = workbook.exportedAt.toISOString().slice(0, 10);
  return new Response(new Uint8Array(workbook.buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="dynasty-boys-complete-history-${day}.xlsx"`,
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Length": String(workbook.buffer.length),
      "X-Export-Sheets": String(workbook.sheetCount),
      "X-Export-Rows": String(workbook.rowCount),
    },
  });
}
