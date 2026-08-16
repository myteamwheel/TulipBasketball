# Patch 13 source-trust deployment status

This branch has passed build validation for the recovered Next.js app.

Production requirements covered in this branch:

- Preserve Patch 11 dashboard experience and Patch 12 recovery/source-trust behavior.
- Keep KTC as the canonical value anchor.
- Add Tradyr as a live secondary market source.
- Keep Dynasty Dealer as a live secondary market source.
- Disable Stats Guy as a consensus source by default; it is diagnostic only unless explicitly re-enabled.
- Rebuild consensus using KTC + Tradyr + Dynasty Dealer only when the secondary value passes freshness and trust-band checks.
- Stop showing unidentified "unmapped player" placeholders; use Sleeper ID/name/position and only warn when no current market value exists from KTC, Tradyr, or Dynasty Dealer.
- Preserve append-only KTC/history tables and the independent backup flow.

Open recovery item:

- The missing pre-outage KTC time-series still requires an old Prisma backup/export/direct connection. No complete pre-outage dashboard JSON/CSV export has been found in the available file library.
