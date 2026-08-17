import { NextResponse } from "next/server";
import { adminDeniedResponse, isAdminRequest } from "@/lib/admin";
import { commitKtcImport, parseKtcCsv, parseKtcJson } from "@/lib/ktcImport";

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return adminDeniedResponse();
  const formData = await request.formData();
  const file = formData.get("file");
  const sourceUrl = formData.get("sourceUrl");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  const text = await file.text();
  const isJson = file.name.toLowerCase().endsWith(".json");
  let rows;
  try { rows = isJson ? parseKtcJson(text) : parseKtcCsv(text); }
  catch (err) { return NextResponse.json({ error: `Failed to parse file: ${err instanceof Error ? err.message : String(err)}` }, { status: 400 }); }
  if (rows.length === 0) return NextResponse.json({ error: "No usable rows found." }, { status: 400 });
  const summary = await commitKtcImport(rows, { sourceUrl: typeof sourceUrl === "string" && sourceUrl ? sourceUrl : file.name, sourceType: isJson ? "MANUAL_JSON" : "MANUAL_CSV" });
  return NextResponse.json({ summary }, { headers: { "Cache-Control": "no-store" } });
}
