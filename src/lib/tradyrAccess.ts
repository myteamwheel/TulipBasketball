export interface TradyrAccessMetadata {
  limited?: boolean;
  reason?: string;
  offsetIgnored?: boolean;
  message?: string;
}

export function tradyrRequestHeaders(
  apiKey: string | null,
): Record<string, string> {
  return {
    Accept: "application/json",
    "Cache-Control": "no-cache, no-store, max-age=0",
    Pragma: "no-cache",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

export function requireCompleteTradyrAccess(
  access: TradyrAccessMetadata | undefined,
  hasApiKey: boolean,
): void {
  if (!access?.limited && !access?.offsetIgnored) return;

  if (!hasApiKey) {
    throw new Error(
      "Tradyr now limits anonymous requests to its first 50 rows and ignores pagination. " +
        "Configure TRADYR_API_KEY with a free Tradyr API key before enabling this source.",
    );
  }

  throw new Error(
    "Tradyr rejected or limited the configured TRADYR_API_KEY; refusing an incomplete snapshot.",
  );
}
