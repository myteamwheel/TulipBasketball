# Dynasty Boys Dashboard

Dynasty-fantasy market terminal for the Dynasty Boys Sleeper league, centered on the Orlando Oswalds.

## Production

- Primary deployment: Vercel project `dynasty-boys-dashboard`
- Production branch: `main`
- Framework: Next.js + Prisma/Postgres
- Current market anchor: KeepTradeCut
- Trusted secondary markets: Tradyr and Dynasty Dealer
- Automatic ingestion: daily around 8 a.m. America/New_York

## Data rules

- KTC is the primary player-value anchor.
- Current decision surfaces require fresh data and never substitute an expired observation as current.
- Portfolio capital may retain the latest verified player or draft-pick value during a provider outage, while stale values remain flagged and excluded from current trade grading.
- June 21, 2026 is the first complete verified Orlando baseline. Earlier partial history is preserved only where it actually exists.
- Historical transaction grading uses stored observations within a bounded event-date tolerance; missing values remain unknown.
- Current trade grading requires complete fresh asset coverage.
- Traded-pick ownership never falls back to an empty trade list when Sleeper is unavailable; the last captured ownership snapshot is used for continuity or pick analysis is withheld.

## Public/privacy boundary

Production pages are password-free and read-only. Public pages expose fantasy-team/player/market information only. Personal notes, stored strategy controls, manual imports, backups/exports, and manual refresh mutations are not exposed through the public UI and their API routes require a separate server-side admin key. Search indexing is disabled by application metadata and response headers.

## Repository layout

The authoritative application lives at the repository root (`src`, `prisma`, `scripts`). Historical G League static data remains isolated under `gleague-static` and its dedicated workflow.
