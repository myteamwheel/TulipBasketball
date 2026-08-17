import { normalizePlayerName } from "@/lib/normalize";

export interface VerifiedKtcIdentity {
  sleeperId: string;
  sleeperName: string;
  ktcId: string;
  ktcName: string;
}

/**
 * Source-controlled identity overrides for rostered players whose KTC identity
 * cannot be recovered reliably from the current top-board name match alone.
 *
 * These are identity mappings only. Values are never hard-coded here: current
 * KTC value continues to come from the live provider feed, and a KTC profile
 * with value 0 remains unknown/unvalued rather than receiving an invented value.
 * KTC profile IDs were verified against the public player profiles on 2026-08-17.
 */
export const VERIFIED_KTC_IDENTITIES: readonly VerifiedKtcIdentity[] = [
  { sleeperId: "13415", sleeperName: "Haynes King", ktcId: "2046", ktcName: "Haynes King" },
  { sleeperId: "11648", sleeperName: "Kedon Slovis", ktcId: "1621", ktcName: "Kedon Slovis" },
  { sleeperId: "827", sleeperName: "Tyrod Taylor", ktcId: "647", ktcName: "Tyrod Taylor" },
  { sleeperId: "4663", sleeperName: "Austin Ekeler", ktcId: "385", ktcName: "Austin Ekeler" },
  { sleeperId: "4018", sleeperName: "Joe Mixon", ktcId: "273", ktcName: "Joe Mixon" },
  { sleeperId: "7567", sleeperName: "Kenny Gainwell", ktcId: "1032", ktcName: "Kenneth Gainwell" },
  { sleeperId: "6151", sleeperName: "Miles Sanders", ktcId: "222", ktcName: "Miles Sanders" },
  { sleeperId: "4988", sleeperName: "Nick Chubb", ktcId: "274", ktcName: "Nick Chubb" },
  { sleeperId: "13418", sleeperName: "Robert Henry", ktcId: "2043", ktcName: "Robert Henry" },
  { sleeperId: "8210", sleeperName: "Chig Okonkwo", ktcId: "1320", ktcName: "Chigoziem Okonkwo" },
  { sleeperId: "13342", sleeperName: "John Michael Gyllenborg", ktcId: "2044", ktcName: "John Michael Gyllenborg" },
  { sleeperId: "13324", sleeperName: "Matt Hibner", ktcId: "2020", ktcName: "Matthew Hibner" },
  { sleeperId: "13434", sleeperName: "Will Kacmarek", ktcId: "2017", ktcName: "Will Kacmarek" },
  { sleeperId: "11615", sleeperName: "Ainias Smith", ktcId: "1624", ktcName: "Ainias Smith" },
  { sleeperId: "5086", sleeperName: "Marquez Valdes-Scantling", ktcId: "369", ktcName: "Marquez Valdes-Scantling" },
] as const;

const canonicalByNormalizedName = new Map<string, string>();
for (const identity of VERIFIED_KTC_IDENTITIES) {
  const canonical = normalizePlayerName(identity.ktcName);
  canonicalByNormalizedName.set(normalizePlayerName(identity.sleeperName), canonical);
  canonicalByNormalizedName.set(canonical, canonical);
}

/** Canonical fallback key for known nickname/legal-name variants. */
export function canonicalKtcMatchName(raw: string): string {
  const normalized = normalizePlayerName(raw);
  return canonicalByNormalizedName.get(normalized) ?? normalized;
}
