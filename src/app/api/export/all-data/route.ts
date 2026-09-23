import { NextResponse } from "next/server";
import { buildCompleteDataWorkbook } from "@/lib/exportWorkbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const workbook = await buildCompleteDataWorkbook();
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(workbook, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Dynasty_Boys_Full_Data_${date}.xlsx"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
