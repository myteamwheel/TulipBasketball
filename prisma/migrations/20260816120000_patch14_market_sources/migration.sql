-- Patch 14: trusted secondary market feeds. Existing observations/history remain untouched.
ALTER TYPE "MarketSource" ADD VALUE IF NOT EXISTS 'TRADYR';
ALTER TYPE "MarketSource" ADD VALUE IF NOT EXISTS 'DYNASTY_DEALER';
