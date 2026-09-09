const KTC_URL = "https://keeptradecut.com/dynasty-rankings";
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const MAX_KTC_PAGES = 15;
const MIN_COMPAT_ROWS = 200;

type FantasyPosition = "QB" | "RB" | "WR" | "TE";

export interface KtcRankingPageRow {
  ktcId?: string;
  name: string;
  position: FantasyPosition;
  team?: string;
  age?: number;
  value: number;
  rank?: number;
  positionRank?: number;
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(raw: string | undefined): string {
  if (!raw) return "";
  return decodeHtmlEntities(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function classInnerHtml(block: string, className: string): string | undefined {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<(?:div|span)[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/(?:div|span)>`,
    "i",
  );
  return block.match(pattern)?.[1];
}

function positiveInt(raw: string): number | undefined {
  const cleaned = raw.replace(/[^0-9]/g, "");
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Parse the rendered KTC ranking rows. KTC used to expose the complete board in
 * `playersArray`; in September 2026 that variable started containing only the
 * three crowd-vote comparison players while the complete rankings remained in
 * the public `.onePlayer` DOM rows.
 */
export function parseKtcRankingPage(html: string): KtcRankingPageRow[] {
  const starts = [
    ...html.matchAll(
      /<div[^>]*class=["'][^"']*\bonePlayer\b[^"']*["'][^>]*>/gi,
    ),
  ];
  const rows: KtcRankingPageRow[] = [];

  for (let index = 0; index < starts.length; index++) {
    const start = starts[index].index;
    if (start === undefined) continue;
    const end = starts[index + 1]?.index ?? html.length;
    const block = html.slice(start, end);

    const nameHtml = classInnerHtml(block, "player-name");
    const anchor = nameHtml?.match(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/i,
    );
    const name = cleanText(anchor?.[2] ?? nameHtml);
    if (!name) continue;

    const positionText = cleanText(classInnerHtml(block, "position"));
    const positionMatch = positionText.match(/\b(QB|RB|WR|TE)\s*(\d+)?\b/i);
    if (!positionMatch) continue;
    const position = positionMatch[1].toUpperCase() as FantasyPosition;
    if (!FANTASY_POSITIONS.has(position)) continue;

    const value = positiveInt(cleanText(classInnerHtml(block, "value")));
    if (!value || value > 10000) continue;

    const rank = positiveInt(cleanText(classInnerHtml(block, "rank-number")));
    const positionRank = positionMatch[2]
      ? Number(positionMatch[2])
      : undefined;
    const team = cleanText(classInnerHtml(block, "player-team")) || undefined;
    const ageText = cleanText(classInnerHtml(block, "age"));
    const ageMatch = ageText.match(/\d+(?:\.\d+)?/);
    const parsedAge = ageMatch ? Number(ageMatch[0]) : undefined;
    const age = Number.isFinite(parsedAge) ? parsedAge : undefined;

    const attrs = anchor?.[1] ?? "";
    const href = attrs.match(/href=["']([^"']+)["']/i)?.[1] ?? "";
    const ktcId = href.match(/\/players\/[^/?#"']*-(\d+)(?:[/?#]|$)/i)?.[1];

    rows.push({
      ktcId,
      name,
      position,
      team,
      age,
      value,
      rank,
      positionRank,
    });
  }

  const deduped = new Map<string, KtcRankingPageRow>();
  for (const row of rows) {
    const key = row.ktcId
      ? `id:${row.ktcId}`
      : `name:${row.name.toLowerCase()}|${row.position}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }
  return [...deduped.values()];
}

function rankingPageUrl(page: number): string {
  const url = new URL(KTC_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("filters", "QB|WR|RB|TE|RDP");
  url.searchParams.set("format", "2");
  return url.toString();
}

function injectPlayersArray(html: string, rows: KtcRankingPageRow[]): string {
  const payload = rows.map((row) => ({
    playerID: row.ktcId ?? "",
    playerName: row.name,
    position: row.position,
    team: row.team ?? "",
    age: row.age ?? null,
    superflexValues: {
      value: row.value,
      overallRank: row.rank ?? null,
      positionalRank: row.positionRank ?? null,
    },
  }));
  return `<script>var playersArray=${JSON.stringify(payload)};</script>${html}`;
}

async function rebuildKtcResponse(
  originalFetch: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Response> {
  const response = await originalFetch(input, init);
  if (!response.ok) return response;

  const html = await response.text();
  const allRows = new Map<string, KtcRankingPageRow>();
  const addRows = (rows: KtcRankingPageRow[]) => {
    let added = 0;
    for (const row of rows) {
      const key = row.ktcId
        ? `id:${row.ktcId}`
        : `name:${row.name.toLowerCase()}|${row.position}`;
      if (allRows.has(key)) continue;
      allRows.set(key, row);
      added++;
    }
    return added;
  };

  addRows(parseKtcRankingPage(html));

  // Fetch ranking pages in small batches to keep refresh latency bounded
  // without hammering the public source. Stop once a whole batch contributes
  // no new fantasy players.
  for (let firstPage = 1; firstPage < MAX_KTC_PAGES; firstPage += 3) {
    const pageNumbers = [firstPage, firstPage + 1, firstPage + 2].filter(
      (page) => page < MAX_KTC_PAGES,
    );
    const pages = await Promise.all(
      pageNumbers.map(async (page) => {
        try {
          const pageResponse = await originalFetch(rankingPageUrl(page), init);
          return pageResponse.ok ? await pageResponse.text() : null;
        } catch {
          return null;
        }
      }),
    );

    let batchAdded = 0;
    for (const pageHtml of pages) {
      if (pageHtml) batchAdded += addRows(parseKtcRankingPage(pageHtml));
    }
    if (batchAdded === 0) break;
  }

  // Fail closed. If KTC changes again and the DOM parser cannot reconstruct a
  // complete board, return the original response so the existing >=200-row
  // safety check rejects it rather than storing a partial market snapshot.
  if (allRows.size < MIN_COMPAT_ROWS) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");
  headers.set("x-dynasty-ktc-compat", String(allRows.size));

  return new Response(injectPlayersArray(html, [...allRows.values()]), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Install a narrowly scoped compatibility layer for the one KTC rankings URL. */
export function installKtcFetchCompatibility(): void {
  const state = globalThis as typeof globalThis & {
    __dynastyKtcFetchCompatibilityInstalled?: boolean;
  };
  if (state.__dynastyKtcFetchCompatibilityInstalled) return;
  state.__dynastyKtcFetchCompatibilityInstalled = true;

  const originalFetch = globalThis.fetch.bind(globalThis) as typeof fetch;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url !== KTC_URL) return originalFetch(input, init);
    return rebuildKtcResponse(originalFetch, input, init);
  }) as typeof fetch;
}
