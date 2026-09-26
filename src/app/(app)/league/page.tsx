import Link from "next/link";
import { getAllCurrentRosterEntries, getPrimaryManager } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations } from "@/lib/teamMetrics";
import { publicTeamName } from "@/lib/publicIdentity";
import RiserFallerTabs, { type MoverRow } from "@/components/RiserFallerTabs";
import SectionHeader from "@/components/SectionHeader";
import { formatPercent, formatPoints, formatSigned, trendColorClass } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

export const dynamic = "force-dynamic";
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
const parseRecord = (value: string | null) => { try { const parsed = JSON.parse(value ?? "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, number> : {}; } catch { return {}; } };

export default async function LeaguePage() {
  const [entries, valuations, primary] = await Promise.all([getAllCurrentRosterEntries(), computeAllTeamValuations(), getPrimaryManager()]);
  const ids = entries.map((entry) => entry.playerId);
  const marketData = await computeMarketDataForPlayers(ids);
  const latestAsOf = [...marketData.values()].map((row) => row.currentObservedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const moverRows: MoverRow[] = entries.map((entry) => { const market = marketData.get(entry.playerId)!; return { id: entry.player.id, fullName: entry.player.fullName, position: entry.player.position, teamName: publicTeamName(entry.manager), currentValue: market.isStale ? null : market.currentValue, changeSinceLastRefresh: market.isStale ? null : market.changeSinceLastRefresh?.points ?? null, change7dPoints: market.isStale ? null : market.change7d?.points ?? null, change30dPoints: market.isStale ? null : market.change30d?.points ?? null }; }).filter((row) => row.currentValue !== null);
  const rank = (key: "totalDynastyValue" | "playerCapital" | "draftCapital" | "optimalLineupValue" | "depthValue") => new Map([...valuations].sort((a, b) => b[key] - a[key]).map((value, index) => [value.managerId, index + 1]));
  const ranks = { total: rank("totalDynastyValue"), players: rank("playerCapital"), picks: rank("draftCapital"), lineup: rank("optimalLineupValue"), depth: rank("depthValue") };
  const anyIncomplete = valuations.some((value) => !value.capitalComplete);
  const missingPlayers = valuations.reduce((sum, value) => sum + value.missingValueCount, 0);
  const draftAvailable = valuations.length > 0 && valuations.every((value) => value.draftMarketAvailable);
  const capitalOrder = [...valuations].sort((a, b) => (draftAvailable ? b.totalDynastyValue - a.totalDynastyValue : b.playerCapital - a.playerCapital));

  const cutoff = new Date(Date.now() - 7 * 86400000);
  const transactions = await prisma.transaction.findMany({ where: { league: { sleeperId: SLEEPER_LEAGUE_ID }, sleeperCreatedAt: { gte: cutoff } }, select: { adds: true, drops: true } });
  const txSleeperIds = [...new Set(transactions.flatMap((tx) => [...Object.keys(parseRecord(tx.adds)), ...Object.keys(parseRecord(tx.drops))]))];
  const txPlayers = await prisma.player.findMany({ where: { sleeperId: { in: txSleeperIds } }, select: { id: true, sleeperId: true } });
  const txMarket = await computeMarketDataForPlayers(txPlayers.map((player) => player.id));
  const playerBySleeper = new Map(txPlayers.map((player) => [player.sleeperId, player.id]));
  const managerByRoster = new Map(entries.map((entry) => [entry.manager.sleeperRosterId, entry.managerId]));
  const rosterChange = new Map<string, number>();
  for (const tx of transactions) for (const [kind, record] of [[1, parseRecord(tx.adds)], [-1, parseRecord(tx.drops)]] as const) for (const [sleeperId, rosterId] of Object.entries(record)) { const playerId = playerBySleeper.get(sleeperId); const managerId = managerByRoster.get(Number(rosterId)); const value = playerId ? txMarket.get(playerId)?.currentValue : null; if (managerId && value !== null && value !== undefined) rosterChange.set(managerId, (rosterChange.get(managerId) ?? 0) + kind * value); }

  const rangeEligible = entries.map((entry) => ({ entry, market: marketData.get(entry.playerId)! })).filter(({ market }) => !market.isStale && market.high && market.low && market.distanceFromHigh !== null && market.low.value > 0 && (market.high.value - market.low.value) / market.low.value >= .05);
  const nearHigh = [...rangeEligible].sort((a, b) => (b.market.distanceFromHigh?.percent ?? -999) - (a.market.distanceFromHigh?.percent ?? -999)).slice(0, 8);
  const drawdowns = [...rangeEligible].filter(({ market }) => (market.distanceFromHigh?.percent ?? 0) < 0).sort((a, b) => (a.market.distanceFromHigh?.percent ?? 0) - (b.market.distanceFromHigh?.percent ?? 0)).slice(0, 8);

  return <div className="min-w-0 space-y-7">
    <div><h1 className="text-xl font-semibold">League Market</h1><p className="mt-1 text-sm text-neutral-400">Capital as of {latestAsOf ? new Date(latestAsOf).toLocaleString("en-US", { timeZone: "America/New_York" }) : "unavailable"}. Unknown values remain unknown.</p></div>
    {anyIncomplete ? <div className="rounded-lg border border-amber-900 bg-amber-950/20 p-3 text-xs text-amber-200">One provisional notice: {missingPlayers} rostered values are unknown, so affected ranks use ~.</div> : null}
    <section><SectionHeader title="League movers" description="Only changes between consecutive fresh readings count as movement."/><RiserFallerTabs rows={moverRows}/></section>
    <section><SectionHeader title={draftAvailable ? "Known dynasty capital" : "Known player capital"} description="Seven-day market movement and roster-composition change from trades/adds are shown separately."/><div className="space-y-2">{capitalOrder.map((value) => { const marketChange = value.change7dCoverage / Math.max(1, value.playerCount) >= .75 ? value.change7d : null; const capital = draftAvailable ? value.totalDynastyValue : value.playerCapital; return <Link href={`/league/${value.managerId}`} key={value.managerId} className="block rounded-lg border border-neutral-800 bg-neutral-900 p-3"><div className="flex justify-between"><div><div className="font-semibold">{anyIncomplete ? "~" : "#"}{(draftAvailable ? ranks.total : ranks.players).get(value.managerId)} · {value.teamName}</div><div className="text-xs text-neutral-400">{value.lastKnownPlayerCount}/{value.playerCount} known · {value.draftPickCount} picks</div></div><div className="text-lg font-semibold">{formatPoints(capital)}</div></div><div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">{[["Players", ranks.players.get(value.managerId)], ["Picks", draftAvailable ? ranks.picks.get(value.managerId) : "—"], ["Lineup", ranks.lineup.get(value.managerId)], ["Depth", ranks.depth.get(value.managerId)]].map(([label, value]) => <div key={String(label)} className="rounded bg-neutral-950 p-2"><div className="text-xs text-neutral-400">{label}</div><div>#{value}</div></div>)}<div className="rounded bg-neutral-950 p-2"><div className="text-xs text-neutral-400">7d market</div><div className={trendColorClass(marketChange)}>{formatSigned(marketChange)}</div></div><div className="rounded bg-neutral-950 p-2"><div className="text-xs text-neutral-400">7d roster</div><div className={trendColorClass(rosterChange.get(value.managerId) ?? 0)}>{formatSigned(rosterChange.get(value.managerId) ?? 0)}</div></div></div></Link>; })}</div></section>
    <section><SectionHeader title="Start-eligible position leaders" description="The top five plus Orlando Oswalds when outside the top five."/><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{POSITIONS.map((position) => { const all = [...valuations].sort((a, b) => (b.positionalStarterValue[position] ?? 0) - (a.positionalStarterValue[position] ?? 0)); const top = all.slice(0, 5); const own = all.find((value) => value.managerId === primary?.id); const shown = own && !top.some((value) => value.managerId === own.managerId) ? [...top, own] : top; return <div key={position} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><h3 className="font-semibold">{position}</h3><ol className="mt-2 space-y-2">{shown.map((value) => { const index = all.findIndex((row) => row.managerId === value.managerId); return <li key={value.managerId} className={`flex justify-between text-xs ${value.managerId === primary?.id ? "rounded bg-emerald-950/30 p-1 text-emerald-300" : ""}`}><Link href={`/league/${value.managerId}`}>#{index + 1} {value.teamName}{value.managerId === primary?.id ? " · You" : ""}</Link><span>{formatPoints(value.positionalStarterValue[position])}</span></li>; })}</ol></div>; })}</div></section>
    {rangeEligible.length ? <section><SectionHeader title="Decision-grade tracked range" description="Requires a tracked high at least 5% above the low; flat prices are excluded."/><div className="grid gap-3 lg:grid-cols-2"><div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><h3 className="mb-2 font-semibold">Closest to tracked high</h3>{nearHigh.map(({ entry, market }) => <Link key={entry.playerId} href={`/players/${entry.playerId}`} className="flex justify-between px-2 py-2 text-xs"><span>{entry.player.fullName}</span><span>{formatPercent(market.distanceFromHigh?.percent)}</span></Link>)}</div><div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><h3 className="mb-2 font-semibold">Largest drawdowns</h3>{drawdowns.map(({ entry, market }) => <Link key={entry.playerId} href={`/players/${entry.playerId}`} className="flex justify-between px-2 py-2 text-xs"><span>{entry.player.fullName}</span><span className="text-red-300">{formatPercent(market.distanceFromHigh?.percent)}</span></Link>)}</div></div></section> : null}
  </div>;
}
