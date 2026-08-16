export const SLEEPER_LEAGUE_ID = "1312155271526625280";

// BrettTulip / "Orlando Oswalds". The roster itself is never hardcoded;
// Sleeper is re-synced on every refresh.
export const ORLANDO_OSWALDS_SLEEPER_USER_ID = "819373914194067456";

export const KTC_FORMAT = "SF-0.5PPR-noTEP";
export const KTC_FORMAT_LABEL = "Superflex / 0.5 PPR / No TE Premium";

// Live market collection. KTC is fetched from its public dynasty-rankings page
// without bypassing authentication, bot challenges, CAPTCHAs, or access controls.
// Product requirement: KTC collection is always attempted on every dashboard refresh.
export const KTC_DIRECT_REFRESH_ENABLED = true;
export const FANTASYCALC_REFRESH_ENABLED = process.env.FANTASYCALC_REFRESH_ENABLED !== "false";
// Stats Guy remains available for diagnostics only. It is OFF by default and never
// participates in consensus unless this implementation is intentionally revisited.
export const STATSGUY_REFRESH_ENABLED = process.env.STATSGUY_REFRESH_ENABLED === "true";
export const KTC_AUTO_REFRESH_ENABLED = KTC_DIRECT_REFRESH_ENABLED;
export const AUTO_REFRESH_ON_VISIT = true;

// A provider must be no older than this to participate in the consensus pool.
// 26h accommodates an approximately-daily calculation plus normal cache/run drift,
// while still excluding genuinely stale boards.
export const MARKET_SOURCE_MAX_AGE_HOURS = Number(process.env.MARKET_SOURCE_MAX_AGE_HOURS || "26");
export const MARKET_SOURCE_MAX_AGE_MS = MARKET_SOURCE_MAX_AGE_HOURS * 60 * 60 * 1000;

// KTC is the canonical market-value scale. Stats Guy is a fresh secondary signal
// that is translated onto KTC scale before it can enter the live consensus.
export const CONSENSUS_WEIGHTS = {
  KTC: 0.80,
  FANTASYCALC: 0.20,
  STATSGUY: 0.00,
} as const;

// A secondary market can disagree with KTC, but it must never manufacture the
// primary value. Large disagreements are surfaced as review flags and excluded
// from consensus rather than averaged blindly.
export const SECONDARY_DISAGREEMENT_ABS = 500;
export const SECONDARY_DISAGREEMENT_REL = 0.50;

// Optional authorized feed remains supported as an emergency/manual alternative.
export const KTC_AUTHORIZED_FEED_URL = process.env.KTC_AUTHORIZED_FEED_URL?.trim() || null;
export const KTC_AUTHORIZED_FEED_TOKEN = process.env.KTC_AUTHORIZED_FEED_TOKEN?.trim() || null;

// Anchored to Eastern-Time midnight (EDT, UTC-4 in June).
export const ORLANDO_BASELINE_DATE = "2026-06-21T04:00:00.000Z";
export const PRE_BASELINE_DATE = "2026-06-07T04:00:00.000Z";
export const DISPLAY_TIMEZONE = "America/New_York";

export const STARTING_REQUIREMENTS = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 3,
  SUPERFLEX: 1,
} as const;

export const LEAGUE_TEAM_COUNT = 12;
export const REFRESH_STALE_MS = 15 * 60 * 1000;
