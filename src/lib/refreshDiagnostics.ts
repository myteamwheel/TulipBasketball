type SourceStatus = { source: string; enabled: boolean; ok: boolean; message?: string };
export function refreshDiagnostics(errors: { source: string; message: string }[], sources: SourceStatus[], status: string) {
  const result = errors.filter(error => !error.source.toLowerCase().includes("fantasycalc"));
  for (const source of sources.filter(source =>
    source.enabled &&
    !source.ok &&
    !source.source.toLowerCase().includes("fantasycalc")
  )) {
    if (!result.some(error => error.source.toLowerCase() === source.source.toLowerCase())) result.push({ source: source.source, message: source.message || "Source refresh failed; its values were excluded." });
  }
  if (status === "PARTIAL_FAILURE" && !result.length) result.push({ source: "Historical run", message: "This run recorded a partial failure without a diagnostic reason. No specific failing source can be verified from the saved record." });
  return result;
}
