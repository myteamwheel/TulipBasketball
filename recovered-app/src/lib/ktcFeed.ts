import { KTC_AUTHORIZED_FEED_TOKEN, KTC_AUTHORIZED_FEED_URL } from "@/lib/config";
import { commitKtcImport, parseKtcCsv, parseKtcJson, type KtcImportSummary } from "@/lib/ktcImport";

export interface AuthorizedKtcRefreshResult {
  enabled: boolean;
  sourceUrl: string | null;
  summary: KtcImportSummary | null;
}

/**
 * Optional compliant automatic KTC ingestion path.
 * This function NEVER calls keeptradecut.com. Configure it only with a feed
 * the user is authorized/licensed to access. The feed may return CSV or JSON
 * accepted by ktcImport.ts.
 */
export async function refreshKtcFromAuthorizedFeed(refreshRunId: string): Promise<AuthorizedKtcRefreshResult> {
  if (!KTC_AUTHORIZED_FEED_URL) return { enabled: false, sourceUrl: null, summary: null };

  const headers: Record<string, string> = {
    Accept: "application/json, text/csv;q=0.9, text/plain;q=0.8",
    "Cache-Control": "no-cache",
  };
  if (KTC_AUTHORIZED_FEED_TOKEN) headers.Authorization = `Bearer ${KTC_AUTHORIZED_FEED_TOKEN}`;

  const response = await fetch(KTC_AUTHORIZED_FEED_URL, { method: "GET", headers, cache: "no-store" });
  if (!response.ok) throw new Error(`Authorized KTC feed failed (${response.status} ${response.statusText})`);

  const text = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const looksJson = contentType.includes("json") || text.trimStart().startsWith("[") || text.trimStart().startsWith("{");
  const rows = looksJson ? parseKtcJson(text) : parseKtcCsv(text);
  if (rows.length === 0) throw new Error("Authorized KTC feed returned no usable player rows");

  const summary = await commitKtcImport(rows, {
    sourceUrl: KTC_AUTHORIZED_FEED_URL,
    refreshRunId,
    sourceType: looksJson ? "MANUAL_JSON" : "MANUAL_CSV",
  });
  const stored = summary.committed + summary.flagged + summary.skippedDuplicates;
  if (stored === 0) throw new Error(`Authorized KTC feed returned ${summary.totalRows} rows but none could be stored or matched`);

  return { enabled: true, sourceUrl: KTC_AUTHORIZED_FEED_URL, summary };
}
