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
export const STATSGUY_REFRESH_ENABLED = process.env.STATSGUY_REFRESH_ENABLED !== "false";
export const DYNASTYDEALER_REFRESH_ENABLED = process.env.DYNASTYDEALER_REFRESH_ENABLED !== "false";
export const KTC_AUTO_REFRESH_ENABLED = KTC_DIRECT_REFRESH_ENABLED;
export const AUTO_REFRESH_ON_VISIT = true;

// A provider must be no older than this to participate in the consensus pool.
// 26h accommodates an approximately-daily calculation plus normal cache/run drift,
// while still excluding genuinely stale boards.
export const MARKET_SOURCE_MAX_AGE_HOURS = Number(process.env.MARKET_SOURCE_MAX_AGE_HOURS || "26");
export const MARKET_SOURCE_MAX_AGE_MS = MARKET_SOURCE_MAX_AGE_HOURS * 60 * 60 * 1000;

// KTC is the canonical market-value scale. Independent secondary markets are
// translated onto KTC scale, but KTC remains the anchor. Per-player reliability
// gates can reduce or exclude a secondary when calibration extrapolates or the
// source remains implausibly far from the live KTC observation.
export const CONSENSUS_WEIGHTS = {
  KTC: 0.70,
  STATSGUY: 0.15,
  DYNASTYDEALER: 0.15,
} as const;

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
