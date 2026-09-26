export function irEligible(status: string | null | undefined, settings: Record<string, number | string>): boolean | null {
  if (!status) return null;
  const code = status.toUpperCase().replace(/[ -]/g, "_");
  if (["IR", "PUP"].includes(code)) return true;
  const flag: Record<string, string> = { OUT: "reserve_allow_out", DOUBTFUL: "reserve_allow_doubtful", SUSPENDED: "reserve_allow_sus", SUS: "reserve_allow_sus", DNR: "reserve_allow_dnr", NA: "reserve_allow_na", COVID: "reserve_allow_cov", COV: "reserve_allow_cov" };
  return flag[code] ? Number(settings[flag[code]]) === 1 : false;
}
export function taxiDeadlineLabel(code: number, inSeason: boolean) {
  const labels: Record<number, string> = { 0: "No deadline", 1: "End of preseason Week 1", 2: "End of preseason Week 2", 3: "End of preseason Week 3", 4: "Start of regular season" };
  return { label: labels[code] ?? "Check league taxi settings", locked: code >= 1 && code <= 4 && inSeason };
}
