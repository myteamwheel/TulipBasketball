export const SLEEPER_LEAGUE_ID = "1312155271526625280";
export const PRIMARY_LEAGUE_NAME = "Dynasty Boys";
export const PRIMARY_TEAM_NAME = "Orlando Oswalds";

export const KTC_FORMAT = "SF-0.5PPR-noTEP";
export const KTC_FORMAT_LABEL = "Superflex / 0.5 PPR / No TE Premium";

export const KTC_DIRECT_REFRESH_ENABLED = true;
export const TRADYR_REFRESH_ENABLED =
  process.env.TRADYR_REFRESH_ENABLED !== "false";
export const TRADYR_API_KEY = process.env.TRADYR_API_KEY?.trim() || null;
export const DYNASTY_DEALER_REFRESH_ENABLED =
  process.env.DYNASTY_DEALER_REFRESH_ENABLED !== "false";
export const FANTASYCALC_REFRESH_ENABLED = false;
export const STATSGUY_REFRESH_ENABLED = false;
export const KTC_AUTO_REFRESH_ENABLED = KTC_DIRECT_REFRESH_ENABLED;
export const AUTO_REFRESH_ON_VISIT = false;

export const MARKET_SOURCE_MAX_AGE_HOURS = Number(
  process.env.MARKET_SOURCE_MAX_AGE_HOURS || "26",
);
export const MARKET_SOURCE_MAX_AGE_MS =
  MARKET_SOURCE_MAX_AGE_HOURS * 60 * 60 * 1000;

export const CONSENSUS_WEIGHTS = {
  KTC: 0.6,
  TRADYR: 0.2,
  DYNASTY_DEALER: 0.2,
} as const;
export const CONSENSUS_TRUSTED_SOURCES = [
  "KTC",
  "TRADYR",
  "DYNASTY_DEALER",
] as const;
export const DIAGNOSTIC_MARKET_SOURCES = [] as const;
export const SECONDARY_KTC_DIVERGENCE_LIMIT = Number(
  process.env.SECONDARY_KTC_DIVERGENCE_LIMIT || "0.35",
);

export const KTC_AUTHORIZED_FEED_URL =
  process.env.KTC_AUTHORIZED_FEED_URL?.trim() || null;
export const KTC_AUTHORIZED_FEED_TOKEN =
  process.env.KTC_AUTHORIZED_FEED_TOKEN?.trim() || null;

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
export const POSITION_STARTER_COUNTS = { QB: 2, RB: 3, WR: 4, TE: 2 } as const;

export const LEAGUE_TEAM_COUNT = 12;
export const REFRESH_STALE_MS = 15 * 60 * 1000;
