/** Reject old blends that contain a removed or unknown provider. */
export function approvedConsensusSources(value: string): string[] | null {
  try {
    const sources: unknown = JSON.parse(value);
    if (!Array.isArray(sources) || sources.length < 2 ||
        !sources.every(source => source === "KTC" || source === "DYNASTY_DEALER") ||
        !sources.includes("KTC") || !sources.includes("DYNASTY_DEALER")) return null;
    return sources;
  } catch {
    return null;
  }
}
