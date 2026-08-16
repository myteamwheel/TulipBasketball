from pathlib import Path

ROOT=Path('recovered-app')

def edit(rel, fn):
    p=ROOT/rel
    s=p.read_text()
    out=fn(s)
    if out==s:
        print(f'warning: no changes for {rel}')
    p.write_text(out)

# Player table: make the preferred secondary explicit and keep Stats Guy diagnostic data out of headline gaps.
def player_table(s):
    s=s.replace(
        '  statsGuyValue: number | null;\n  statsGuyRawValue: number | null;',
        '  fantasyCalcValue: number | null;\n  fantasyCalcRawValue: number | null;\n  statsGuyValue: number | null;\n  statsGuyRawValue: number | null;'
    )
    s=s.replace('function marketGapPct(ktc: number | null, sg: number | null) {\n  if (ktc === null || sg === null || ktc <= 0) return null;\n  return ((sg - ktc) / ktc) * 100;\n}',
                'function marketGapPct(ktc: number | null, secondary: number | null) {\n  if (ktc === null || secondary === null || ktc <= 0) return null;\n  return ((secondary - ktc) / ktc) * 100;\n}')
    s=s.replace('{r.statsGuyValue !== null && <div className="text-[9px] text-neutral-600">KTC {formatPoints(r.currentValue)} · secondary→KTC {formatPoints(r.statsGuyValue)}</div>}',
                '{r.fantasyCalcValue !== null ? <div className="text-[9px] text-neutral-600">KTC {formatPoints(r.currentValue)} · FC→KTC {formatPoints(r.fantasyCalcValue)}</div> : <div className="text-[9px] text-neutral-600">KTC anchor only</div>}')
    s=s.replace('const gap = marketGapPct(r.currentValue, r.statsGuyValue);', 'const gap = marketGapPct(r.currentValue, r.fantasyCalcValue);')
    s=s.replace('secondary→KTC vs KTC', 'FantasyCalc→KTC vs KTC')
    s=s.replace('{r.statsGuyValue !== null && (() => { const gap = marketGapPct(r.currentValue, r.fantasyCalcValue);', '{r.fantasyCalcValue !== null && (() => { const gap = marketGapPct(r.currentValue, r.fantasyCalcValue);')
    s=s.replace('secondary gap {gap === null ? "n/a"', 'FC gap {gap === null ? "n/a"')
    return s
edit('src/components/PlayerTable.tsx', player_table)

# Home page: propagate FantasyCalc values and use them for the actionable disagreement board.
def home(s):
    s=s.replace('      statsGuyValue: mix.statsGuyValue, statsGuyRawValue: mix.statsGuyRawValue,',
                '      fantasyCalcValue: mix.fantasyCalcValue, fantasyCalcRawValue: mix.fantasyCalcRawValue,\n      statsGuyValue: mix.statsGuyValue, statsGuyRawValue: mix.statsGuyRawValue,')
    s=s.replace('sourceGapPct(r.currentValue, r.statsGuyValue)', 'sourceGapPct(r.currentValue, r.fantasyCalcValue)')
    s=s.replace('<span className={`status-pill ${sourceStatuses.STATSGUY.stale ? "text-amber-300" : "text-emerald-300"}`}>Stats Guy {sourceStatuses.STATSGUY.stale ? "stale" : "fresh"}</span>',
                '<span className={`status-pill ${sourceStatuses.FANTASYCALC.stale ? "text-amber-300" : "text-emerald-300"}`}>FantasyCalc {sourceStatuses.FANTASYCALC.stale ? "stale" : "fresh"}</span>')
    return s
edit('src/app/(app)/page.tsx', home)

# Player market rows.
def players(s):
    s=s.replace('      statsGuyValue: mix.statsGuyValue, statsGuyRawValue: mix.statsGuyRawValue,',
                '      fantasyCalcValue: mix.fantasyCalcValue, fantasyCalcRawValue: mix.fantasyCalcRawValue,\n      statsGuyValue: mix.statsGuyValue, statsGuyRawValue: mix.statsGuyRawValue,')
    return s
edit('src/app/(app)/players/page.tsx', players)

# League disagreement board.
def league(s):
    s=s.replace('return { e, ktc, sg: mix?.statsGuyValue ?? null, gap: sourceGapPct(ktc, mix?.statsGuyValue ?? null) };',
                'return { e, ktc, secondary: mix?.fantasyCalcValue ?? null, gap: sourceGapPct(ktc, mix?.fantasyCalcValue ?? null) };')
    s=s.replace('description="Stats Guy is translated onto the KTC scale first. Large gaps identify players where the markets disagree, not automatic buys or sells."',
                'description="FantasyCalc is translated onto the KTC scale first. Large gaps are review flags; extreme disagreements are excluded from consensus instead of averaged blindly."')
    s=s.replace('disagreement.map(({ e, ktc, sg, gap })', 'disagreement.map(({ e, ktc, secondary, gap })')
    s=s.replace('· SG→KTC {formatPoints(sg)}', '· FC→KTC {formatPoints(secondary)}')
    return s
edit('src/app/(app)/league/page.tsx', league)

# Settings: explicit trust hierarchy and cadence provenance.
def settings(s):
    s=s.replace('KTC_DIRECT_REFRESH_ENABLED, KTC_FORMAT_LABEL, MARKET_SOURCE_MAX_AGE_HOURS, SLEEPER_LEAGUE_ID, ORLANDO_OSWALDS_SLEEPER_USER_ID, STATSGUY_REFRESH_ENABLED, DISPLAY_TIMEZONE',
                'KTC_DIRECT_REFRESH_ENABLED, KTC_FORMAT_LABEL, MARKET_SOURCE_MAX_AGE_HOURS, SLEEPER_LEAGUE_ID, ORLANDO_OSWALDS_SLEEPER_USER_ID, FANTASYCALC_REFRESH_ENABLED, STATSGUY_REFRESH_ENABLED, DISPLAY_TIMEZONE')
    s=s.replace(
        '    { key:"KTC" as const, enabled:KTC_DIRECT_REFRESH_ENABLED, label:"KeepTradeCut", detail:"Primary live dynasty market source · Superflex / 0.5 PPR / no TEP · freshness marker must pass the cutoff" },\n    { key:"STATSGUY" as const, enabled:STATSGUY_REFRESH_ENABLED, label:"Stats Guy (diagnostic) Fantasy", detail:"Secondary live market source · official API · sf_dynasty freshness must pass the cutoff · raw scores are translated onto KTC scale before consensus" },',
        '    { key:"KTC" as const, enabled:KTC_DIRECT_REFRESH_ENABLED, label:"KeepTradeCut", detail:"Canonical anchor · Superflex / 0.5 PPR / no TEP · public freshness marker must pass the cutoff · deep ranking pages are merged so low-ranked rostered players are not silently missed" },\n'
        '    { key:"FANTASYCALC" as const, enabled:FANTASYCALC_REFRESH_ENABLED, label:"FantasyCalc", detail:"Preferred secondary · exact 12-team Superflex / 0.5-PPR feed · live API fetch · provider publishes a 3-hour recalculation cadence · translated onto KTC scale before use" },\n'
        '    { key:"STATSGUY" as const, enabled:STATSGUY_REFRESH_ENABLED, label:"Stats Guy", detail:"Diagnostic-only secondary · disabled by default · stored only for comparison when explicitly enabled and never used to manufacture the headline consensus" },'
    )
    s=s.replace('Build: PATCH 12 · preserves DECISION CENTER + QOL PATCH 11', 'Build: MARKET INTEGRITY + RECOVERY PATCH 14 · preserves DECISION CENTER + QOL PATCH 11')
    s=s.replace('<span className="font-medium text-neutral-300">Consensus:</span> KTC is the 75% anchor; Stats Guy (diagnostic) is 25% after same-refresh position-aware quantile calibration onto the KTC scale. Raw Stats Guy (diagnostic) numbers are never averaged directly with KTC.',
                '<span className="font-medium text-neutral-300">Consensus:</span> KTC is mandatory and remains the canonical anchor. FantasyCalc can contribute 20% after same-refresh calibration onto the KTC scale. If the translated secondary differs by at least 500 points and 50%, it is excluded and the consensus falls back to KTC alone. Stats Guy is diagnostic-only by default.')
    return s
edit('src/app/(app)/settings/page.tsx', settings)

print('Patch 14 source-trust UI updates applied')
