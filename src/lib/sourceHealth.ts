export function sourceHealth(stale: boolean, covered: number, attempt?: { enabled: boolean; ok: boolean; message?: string }) {
  if (attempt?.enabled === false) return { label: "Disabled", tone: "neutral", message: attempt.message ?? "Optional source disabled by configuration." } as const;
  if (attempt?.ok === false) return {
    label: !stale && covered > 0 ? "Refresh failed · previous data still fresh" : "Refresh failed",
    tone: "warning",
    message: attempt.message ?? "The last source refresh failed; only previously verified data can be shown.",
  } as const;
  if (stale) return { label: "Stale / unavailable", tone: "warning", message: "This source is excluded from current market calculations." } as const;
  if (covered === 0) return { label: "No player coverage", tone: "warning", message: "The feed has no fresh usable values for current league players." } as const;
  return { label: "Fresh", tone: "positive", message: null } as const;
}
