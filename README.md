# TulipBasketball

Prebuilt deployment for the TulipBasketball NBA draft game plus the historical G League mode at `/gleague`.

## G League mode implemented

- Uniform team selection among every franchise with five legal cards for the current roster slot; the team is selected directly before the wheel animation, so no landed result can be discarded or remapped.
- A selectable six-use franchise override that can explicitly choose Long Island or any other eligible team.
- 31 active affiliate/independent franchises plus the defunct G League Ignite program.
- Current Coachella Valley Lakers identity with South Bay Lakers and Los Angeles D-Fenders history retained in the same lineage.
- One record per player-team-season. Players can appear in multiple seasons and for multiple franchises.
- Official season statistics, official G League headshot URL, biographical fields, NBA career games, draft pedigree, awards and season leaders.
- Overall model combines season production/efficiency, G League experience, NBA games, draft position and accolades. MVP Mac McClung cards for 2023-24 and 2025-26 have a 95 OVR floor.
- Automated data integrity audit checks all 32 wheel teams, every roster-position family, Long Island reachability, Ignite inclusion, unique card IDs, required fields and rating bounds.

## Deployment

Railway only needs `npm start`. `bootstrap.mjs` reconstructs and extracts the prebuilt site archive and serves the prebuilt site without third-party runtime dependencies.

The `Sync G League history` GitHub Action rebuilds the historical player-season database from official NBA G League statistics and commits the refreshed split site archive, which triggers the connected Railway deployment.
