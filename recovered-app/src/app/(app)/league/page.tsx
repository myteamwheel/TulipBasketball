import Link from "next/link";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations } from "@/lib/teamMetrics";
import { getCurrentMarketMix } from "@/lib/marketSources";
import RiserFallerTabs, { type MoverRow } from "@/components/RiserFallerTabs";
import SectionHeader from "@/components/SectionHeader";
import { formatPoints, formatSigned, trendColorClass } from "@/lib/format";
import { CORE_POSITIONS, powerTier, sourceGapPct } from "@/lib/dashboardInsights";

export const dynamic = "force-dynamic";

export default async function LeaguePage() {
  const entries = await getAllCurrentRosterEntries();
  const playerIds = entries.map((e) => e.playerId);
  const [marketData, marketMix, valuations] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    getCurrentMarketMix(playerIds),
    computeAllTeamValuations(),
  ]);

  const consensusByManager = new Map<string, { total: number; covered: number; rostered: number }>();
  for (const e of entries) {
    const current = consensusByManager.get(e.managerId) ?? { total: 0, covered: 0, rostered: 0 };
    current.rostered += 1;
    const value = marketMix.get(e.playerId)?.consensusValue ?? null;
    if (value !== null) { current.total += value; current.covered += 1; }
    consensusByManager.set(e.managerId, current);
  }

  const moverRows: MoverRow[] = entries.map((e) => {
    const m = marketData.get(e.playerId)!;
    return {
      id: e.player.id, fullName: e.player.fullName, position: e.player.position,
      teamName: e.manager.teamName ?? e.manager.displayName,
      currentValue: m.currentValue,
      changeSinceLastRefresh: m.changeSinceLastRefresh?.points ?? null,
      change7dPoints: m.change7d?.points ?? null,
      change30dPoints: m.change30d?.points ?? null,
    };
  }).filter((r) => r.currentValue !== null);

  const ranked = [...valuations].sort((a, b) => b.totalValue - a.totalValue);
  const leader = ranked[0];
  const sixth = ranked[Math.min(5, ranked.length - 1)];
  const leagueTotal = ranked.reduce((s, v) => s + v.totalValue, 0);
  const average = ranked.length ? leagueTotal / ranked.length : 0;

  const starterRank = new Map([...valuations].sort((a, b) => b.starterValue - a.starterValue).map((v, i) => [v.managerId, i + 1]));
  const depthRank = new Map([...valuations].sort((a, b) => b.benchValue - a.benchValue).map((v, i) => [v.managerId, i + 1]));
  const posRanks = new Map<string, Record<string, number>>();
  for (const pos of CORE_POSITIONS) {
    [...valuations].sort((a, b) => (b.positionalValue[pos] ?? 0) - (a.positionalValue[pos] ?? 0)).forEach((v, i) => {
      const current = posRanks.get(v.managerId) ?? {};
      current[pos] = i + 1;
      posRanks.set(v.managerId, current);
    });
  }

  const positionLeaders = CORE_POSITIONS.map((position) => {
    const sorted = [...valuations].sort((a, b) => (b.positionalValue[position] ?? 0) - (a.positionalValue[position] ?? 0));
    return { position, team: sorted[0], value: sorted[0]?.positionalValue[position] ?? 0 };
  });

  const disagreement = entries.map((e) => {
    const mix=marketMix.get(e.playerId); const ktc=mix?.ktcValue??null;
    const candidates=[{source:"Stats Guy",value:mix?.statsGuyValue??null},{source:"Dynasty Dealer",value:mix?.dynastyDealerValue??null}]
      .map((x)=>({...x,gap:sourceGapPct(ktc,x.value)})).filter((x):x is typeof x & {gap:number}=>x.gap!==null).sort((a,b)=>Math.abs(b.gap)-Math.abs(a.gap));
    const largest=candidates[0]??null; return {e,ktc,source:largest?.source??null,secondary:largest?.value??null,gap:largest?.gap??null};
  }).filter((x): x is typeof x & { gap: number; source:string; secondary:number } => x.gap !== null && x.source !== null && x.secondary !== null)
    .sort((a,b)=>Math.abs(b.gap)-Math.abs(a.gap)).slice(0,8);

  const withValue = valuations.filter((v) => v.totalValue > 0);
  const concentrated = [...withValue].map((v) => {
    const top3 = entries.filter((e) => e.managerId === v.managerId)
      .map((e) => marketData.get(e.playerId)?.currentValue ?? 0).sort((a, b) => b - a).slice(0, 3).reduce((s, x) => s + x, 0);
    return { ...v, concentration: v.totalValue > 0 ? top3 / v.totalValue : 0 };
  }).sort((a, b) => b.concentration - a.concentration);

  return (
    <div className="space-y-7">
      <section className="hero-panel">
        <div className="relative z-[1]">
          <div className="eyebrow">League-wide market map</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-neutral-50">League Market</h1>
          <p className="mt-2 max-w-3xl text-sm text-neutral-400">Power rankings, roster construction, meaningful movers, and where independently refreshed market sources disagree enough to deserve a second look.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="metric-card"><div className="metric-label">League leader</div><div className="metric-value truncate">{leader?.teamName ?? "—"}</div><div className="metric-sub">{formatPoints(leader?.totalValue)} KTC</div></div>
            <div className="metric-card"><div className="metric-label">Playoff line (#6)</div><div className="metric-value truncate">{sixth?.teamName ?? "—"}</div><div className="metric-sub">{formatPoints(sixth?.totalValue)} KTC</div></div>
            <div className="metric-card"><div className="metric-label">League average</div><div className="metric-value">{formatPoints(average)}</div><div className="metric-sub">per roster</div></div>
            <div className="metric-card"><div className="metric-label">Top-to-#6 spread</div><div className="metric-value">{formatPoints((leader?.totalValue ?? 0) - (sixth?.totalValue ?? 0))}</div><div className="metric-sub">value separation</div></div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader eyebrow="Power board" title="Who actually has the strongest market portfolio?" description="Bars are scaled to the league leader. The tier label is based on total KTC rank; starter and depth ranks are shown separately so a deep roster is not mistaken for a loaded starting lineup." />
        <div className="panel overflow-hidden">
          <div className="divide-y divide-neutral-800/80">
            {ranked.map((v, i) => {
              const width = leader?.totalValue ? Math.max(5, (v.totalValue / leader.totalValue) * 100) : 0;
              const tier = powerTier(i + 1, ranked.length);
              const ranks = posRanks.get(v.managerId) ?? {};
              const best = CORE_POSITIONS.map((p) => ({ p, r: ranks[p] ?? 99 })).sort((a, b) => a.r - b.r)[0];
              const weak = CORE_POSITIONS.map((p) => ({ p, r: ranks[p] ?? 0 })).sort((a, b) => b.r - a.r)[0];
              return <div key={v.managerId} className="px-3 py-3 sm:px-4">
                <div className="flex items-center gap-3">
                  <div className="w-7 shrink-0 text-center text-sm font-bold text-neutral-500">#{i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><div className="truncate text-sm font-semibold text-neutral-100">{v.teamName}</div><div className="text-[10px] text-neutral-600">{tier.label} · starters #{starterRank.get(v.managerId)} · depth #{depthRank.get(v.managerId)} · best {best?.p} #{best?.r} · weakest {weak?.p} #{weak?.r}</div></div><div className="text-right"><div className="text-sm font-bold text-neutral-100">{formatPoints(v.totalValue)}</div><div className={`text-[10px] ${trendColorClass(v.change7d)}`}>{formatSigned(v.change7d)} 7d</div></div></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800"><div className="h-full rounded-full bg-gradient-to-r from-emerald-700 to-emerald-300" style={{ width: `${width}%` }} /></div>
                  </div>
                </div>
              </div>;
            })}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader eyebrow="Roster identity" title="Position leaders" description="Which team owns the most KTC value at each core position right now." />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {positionLeaders.map((x) => <div key={x.position} className="panel p-3"><div className="eyebrow">{x.position} leader</div><div className="mt-2 truncate text-sm font-semibold text-neutral-100">{x.team?.teamName ?? "—"}</div><div className="mt-1 text-xl font-bold text-neutral-50">{formatPoints(x.value)}</div></div>)}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader eyebrow="Momentum" title="League movers" description="Use 7-day and 30-day windows for meaningful movement; the refresh-to-refresh window is still available inside the player table but is intentionally not the headline metric." />
        <RiserFallerTabs rows={moverRows} />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <SectionHeader eyebrow="Market disagreement" title="Largest source gaps" description="Stats Guy and Dynasty Dealer are independently translated onto the KTC scale first. Extreme or extrapolated gaps are excluded from consensus, and no comparison is shown unless the KTC anchor itself is fresh. This board is a review queue, not a buy/sell list." />
          <div className="panel divide-y divide-neutral-800/80 px-4">
            {disagreement.map(({ e, ktc, source, secondary, gap }) => <Link key={e.playerId} href={`/players/${e.playerId}`} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><div className="truncate text-sm font-medium text-neutral-100">{e.player.fullName}</div><div className="text-[10px] text-neutral-600">{e.manager.teamName ?? e.manager.displayName} · KTC {formatPoints(ktc)} · {source}→KTC {formatPoints(secondary)}</div></div><div className={`shrink-0 text-sm font-bold ${gap >= 0 ? "text-sky-300" : "text-amber-300"}`}>{gap > 0 ? "+" : ""}{gap.toFixed(1)}%</div></Link>)}
          </div>
        </div>
        <div className="space-y-3">
          <SectionHeader eyebrow="Risk profile" title="Most top-heavy rosters" description="Share of total roster value concentrated in the three most valuable players. High concentration means more ceiling—and more single-player risk." />
          <div className="panel divide-y divide-neutral-800/80 px-4">
            {concentrated.slice(0, 6).map((v) => <div key={v.managerId} className="py-3"><div className="flex items-center justify-between text-sm"><span className="font-medium text-neutral-100">{v.teamName}</span><span className="text-neutral-300">{Math.round(v.concentration * 100)}%</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-800"><div className="h-full rounded-full bg-neutral-500" style={{ width: `${Math.min(100, v.concentration * 100)}%` }} /></div></div>)}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader eyebrow="Reference table" title="Team valuation matrix" description="Detailed totals, consensus coverage, position ranks, and 7-day change. Position ranks are easier to compare than four raw-value columns with different positional markets." />
        <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-neutral-800 text-[10px] uppercase tracking-wide text-neutral-500"><th className="px-3 py-2 text-left">Rank</th><th className="px-3 py-2 text-left">Team</th><th className="px-2 py-2 text-right">KTC</th><th className="px-2 py-2 text-right">Consensus</th><th className="px-2 py-2 text-right">Starters</th><th className="px-2 py-2 text-right">Depth</th>{CORE_POSITIONS.map((p)=><th key={p} className="px-2 py-2 text-right">{p} rank</th>)}<th className="px-2 py-2 text-right">7d</th></tr></thead>
            <tbody>{ranked.map((v, i) => {
              const c = consensusByManager.get(v.managerId); const ranks = posRanks.get(v.managerId) ?? {};
              return <tr key={v.managerId} className="border-b border-neutral-900 hover:bg-neutral-800/30"><td className="px-3 py-2 text-neutral-500">#{i+1}</td><td className="px-3 py-2 font-medium text-neutral-100">{v.teamName}</td><td className="px-2 py-2 text-right font-semibold text-neutral-100">{formatPoints(v.totalValue)}</td><td className="px-2 py-2 text-right text-emerald-300">{c?.covered ? <>{formatPoints(c.total)}<div className="text-[9px] text-neutral-600">{c.covered}/{c.rostered}</div></> : "n/a"}</td><td className="px-2 py-2 text-right text-neutral-300">#{starterRank.get(v.managerId)}</td><td className="px-2 py-2 text-right text-neutral-300">#{depthRank.get(v.managerId)}</td>{CORE_POSITIONS.map((p)=><td key={p} className="px-2 py-2 text-right text-neutral-400">#{ranks[p] ?? "—"}<div className="text-[9px] text-neutral-700">{formatPoints(v.positionalValue[p] ?? 0)}</div></td>)}<td className={`px-2 py-2 text-right ${trendColorClass(v.change7d)}`}>{formatSigned(v.change7d)}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
