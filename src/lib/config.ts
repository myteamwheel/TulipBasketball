export const SLEEPER_LEAGUE_ID = "1312155271526625280";

// BrettTulip / Orlando Oswalds. Roster ownership is never hardcoded; Sleeper is
// reconciled on every successful roster refresh.
export const ORLANDO_OSWALDS_SLEEPER_USER_ID = "819373914194067456";

export const KTC_FORMAT = "SF-0.5PPR-noTEP";
export const KTC_FORMAT_LABEL = "Superflex / 0.5 PPR / No TE Premium";

export const KTC_DIRECT_REFRESH_ENABLED = true;
export const TRADYR_REFRESH_ENABLED = process.env.TRADYR_REFRESH_ENABLED !== "false";
export const DYNASTY_DEALER_REFRESH_ENABLED = process.env.DYNASTY_DEALER_REFRESH_ENABLED !== "false";
// Diagnostic feeds are stored for cross-checking but do not alter trusted consensus.
export const FANTASYCALC_REFRESH_ENABLED = process.env.FANTASYCALC_REFRESH_ENABLED !== "false";
export const STATSGUY_REFRESH_ENABLED = process.env.STATSGUY_REFRESH_ENABLED !== "false";
export const KTC_AUTO_REFRESH_ENABLED = KTC_DIRECT_REFRESH_ENABLED;
export const AUTO_REFRESH_ON_VISIT = true;

// A provider must be no older than this to participate in a current comparison.
export const MARKET_SOURCE_MAX_AGE_HOURS = Number(process.env.MARKET_SOURCE_MAX_AGE_HOURS || "26");
export const MARKET_SOURCE_MAX_AGE_MS = MARKET_SOURCE_MAX_AGE_HOURS * 60 * 60 * 1000;

// Trusted market stack. KTC remains the anchor; secondary feeds are calibrated
// to KTC scale before they can participate in consensus.
export const CONSENSUS_WEIGHTS = {
  KTC: 0.6,
  TRADYR: 0.2,
  DYNASTY_DEALER: 0.2,
} as const;
export const CONSENSUS_TRUSTED_SOURCES = ["KTC", "TRADYR", "DYNASTY_DEALER"] as const;
export const DIAGNOSTIC_MARKET_SOURCES = ["FANTASYCALC", "STATSGUY"] as const;
export const SECONDARY_KTC_DIVERGENCE_LIMIT = Number(process.env.SECONDARY_KTC_DIVERGENCE_LIMIT || "0.35");

export const KTC_AUTHORIZED_FEED_URL = process.env.KTC_AUTHORIZED_FEED_URL?.trim() || null;
export const KTC_AUTHORIZED_FEED_TOKEN = process.env.KTC_AUTHORIZED_FEED_TOKEN?.trim() || null;

// June 21 is the first supplied checkpoint with values for the complete 29-player
// Orlando roster and is therefore the authoritative portfolio baseline. June 7
// remains available only as partial pre-baseline history for players that had a
// verified value on that date.
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
