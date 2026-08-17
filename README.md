# Dynasty Boys Dashboard

Private dynasty-fantasy market terminal for the Dynasty Boys Sleeper league, centered on the Orlando Oswalds.

## Production

- Primary deployment: Vercel project `dynasty-boys-dashboard`
- Production branch: `main`
- Framework: Next.js + Prisma/Postgres
- Current market anchor: KeepTradeCut
- Trusted secondary markets: Tradyr and Dynasty Dealer
- Automatic ingestion: daily around 8 a.m. America/New_York, plus explicit manual refreshes

## Data rules

- KTC is the primary player-value anchor.
- Current-decision surfaces require fresh data and never substitute an expired observation as if it were current.
- Portfolio capital may retain the latest verified player or draft-pick value during a provider outage, but stale values are visibly marked and excluded from current trade grading.
- June 21, 2026 is the first complete verified Orlando baseline. Earlier partial history is preserved only where it actually exists.
- Historical trade/add-drop grading uses stored observations within a bounded event-date tolerance; missing historical values are left unknown rather than invented.
- Current trade grading requires complete fresh asset coverage, including a fresh draft-pick market for trades containing picks.

## Privacy

Production is password protected and fails closed when the required authentication configuration is missing. Data-bearing API routes independently verify the authenticated session; scheduled ingestion uses the cron route under `/api/cron/daily-refresh/...`.

## Repository layout

The authoritative application lives at the repository root (`src`, `prisma`, `scripts`). Old recovery copies are intentionally not part of the production build. Historical G League static data remains isolated under `gleague-static` and its dedicated sync workflow.
