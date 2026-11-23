import { writeFile } from "node:fs/promises";
import { VERIFIED_KTC_IDENTITIES } from "../src/lib/ktcIdentityOverrides";
import { parseKtcDailyHistory } from "../src/lib/historicalKtc";

// Restrict requests to known, manually verified identity mappings. The dated
// chart, not the possibly stale league catalog, supplies the actual prices.
async function main() {
  const response = await fetch("https://keeptradecut.com/dynasty/power-rankings/players?leagueId=1312155271526625280&platform=Sleeper", { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`KTC catalog HTTP ${response.status}`);
  const html = await response.text();
  const marker = /var playersArray\s*=\s*/.exec(html);
  if (!marker) throw new Error("KTC catalog missing");
  const start = html.indexOf("[", marker.index + marker[0].length);
  let index = start, depth = 0, inString = false, escaped = false;
  for (; index < html.length; index++) {
    const c = html[index];
    if (inString) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') inString = false; }
    else if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  const catalog = JSON.parse(html.slice(start, index + 1)) as { playerID: number; slug: string }[];
  if (catalog.length < 800) throw new Error("KTC catalog incomplete");
  const today = new Date().toISOString().slice(0, 10), cutoff = Date.parse(today + "T00:00:00Z") - 2 * 86400000;
  const quotes: { playerId: string; profile: string; now: { date: string; value: number } | null; history: { d: string; v: number }[] }[] = [];
  let next = 0;
  async function worker() {
    while (next < VERIFIED_KTC_IDENTITIES.length) {
      const identity = VERIFIED_KTC_IDENTITIES[next++];
      const matches = catalog.filter(p => String(p.playerID) === identity.ktcId);
      if (matches.length !== 1 || !/^[a-z0-9-]+$/.test(matches[0].slug)) continue;
      const profile = "https://keeptradecut.com/dynasty-rankings/players/" + matches[0].slug;
      try {
        const page = await fetch(profile, { signal: AbortSignal.timeout(30000) });
        if (!page.ok) continue;
        const history = parseKtcDailyHistory(await page.text(), Number(identity.ktcId));
        const recent = history.toReversed().flatMap(point => {
          const date = "20" + point.d.slice(0, 2) + "-" + point.d.slice(2, 4) + "-" + point.d.slice(4, 6);
          const time = Date.parse(date + "T00:00:00Z");
          return time >= cutoff && date <= today && Number.isInteger(point.v) && point.v > 0 && point.v <= 9999 ? [{ date, value: point.v }] : [];
        }).sort((a, b) => b.date.localeCompare(a.date));
        const dated = history.filter(point => {
          const date = "20" + point.d.slice(0, 2) + "-" + point.d.slice(2, 4) + "-" + point.d.slice(4, 6);
          return date <= today && Number.isInteger(point.v) && point.v > 0 && point.v <= 9999;
        });
        if (dated.length) quotes.push({ playerId: identity.sleeperId, profile, now: recent[0] ?? null, history: dated });
      } catch { /* Leave unavailable if a profile cannot be verified. */ }
    }
  }
  await Promise.all([worker(), worker()]);
  if (!quotes.length) throw new Error("No verified recent KTC profile quotes; preserving prior archive");
  quotes.sort((a, b) => a.playerId.localeCompare(b.playerId));
  await writeFile("src/data/trade-profile-quotes.json", JSON.stringify({ checkedAt: new Date().toISOString(), quotes }) + "\n");
  console.log(`Collected ${quotes.length} verified, dated KTC profile quotes.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
