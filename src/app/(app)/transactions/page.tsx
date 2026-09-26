import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { closestObservation, computeMarketDataForPlayers, getObservationSeries } from "@/lib/metrics";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { publicTeamName } from "@/lib/publicIdentity";
import { formatDateTimeEastern, formatPoints, formatSigned, trendColorClass } from "@/lib/format";
import { computeAllTeamValuations } from "@/lib/teamMetrics";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
type TxFilter = "all" | "trade" | "moves";
type TradedPick = { season: string; round: number; roster_id: number; previous_owner_id: number; owner_id: number };
type FaabTransfer = { amount: number; sender: number; receiver: number };
type Asset = { id: string | null; label: string; atMove: number | null; current: number | null };

function record(value: string | null): Record<string, number> {
  try { const parsed = JSON.parse(value ?? "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function array<T>(value: string | null): T[] {
  try { const parsed = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function href(filter: TxFilter, page: number) {
  const query = new URLSearchParams();
  if (filter !== "all") query.set("type", filter);
  if (page > 1) query.set("page", String(page));
  return query.size ? `/transactions?${query}` : "/transactions";
}
function waiverBid(raw: string) {
  try { const value = Number((JSON.parse(raw) as { settings?: { waiver_bid?: unknown } }).settings?.waiver_bid); return Number.isFinite(value) ? value : null; } catch { return null; }
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ type?: string; page?: string }> }) {
  const params = await searchParams;
  const filter: TxFilter = params.type === "trade" ? "trade" : params.type === "moves" ? "moves" : "all";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const where: Prisma.TransactionWhereInput = { league: { sleeperId: SLEEPER_LEAGUE_ID }, ...(filter === "trade" ? { type: "trade" } : filter === "moves" ? { type: { not: "trade" } } : {}) };
  const total = await prisma.transaction.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const [transactions, managers, valuations] = await Promise.all([
    prisma.transaction.findMany({ where, orderBy: { sleeperCreatedAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.manager.findMany({ where: { league: { sleeperId: SLEEPER_LEAGUE_ID } } }),
    computeAllTeamValuations(),
  ]);
  const sleeperIds = [...new Set(transactions.flatMap((tx) => [...Object.keys(record(tx.adds)), ...Object.keys(record(tx.drops))]))];
  const players = await prisma.player.findMany({ where: { sleeperId: { in: sleeperIds } }, select: { id: true, sleeperId: true, fullName: true, position: true } });
  const [series, currentMarket] = await Promise.all([getObservationSeries(players.map((p) => p.id)), computeMarketDataForPlayers(players.map((p) => p.id))]);
  const managerByRoster = new Map(managers.map((m) => [m.sleeperRosterId, m]));
  const playerBySleeper = new Map(players.map((p) => [p.sleeperId, p]));
  const pickValues = new Map(valuations.flatMap((team) => team.draftPicks.map((pick) => [pick.id, pick.value] as const)));
  const teamName = (rosterId: number) => managerByRoster.has(rosterId) ? publicTeamName(managerByRoster.get(rosterId)!) : `Team ${rosterId}`;

  function playerAsset(sleeperId: string, date: Date): Asset {
    const player = playerBySleeper.get(sleeperId);
    if (!player) return { id: null, label: `Sleeper player ${sleeperId}`, atMove: null, current: null };
    const atMove = closestObservation(series.get(player.id) ?? [], date, "before")?.value ?? null;
    const market = currentMarket.get(player.id);
    return { id: player.id, label: `${player.fullName} (${player.position})`, atMove, current: market && !market.isStale ? market.currentValue : null };
  }
  const rows = transactions.map((tx) => {
    const adds = record(tx.adds), drops = record(tx.drops), picks = array<TradedPick>(tx.draftPicks);
    const rosterIds = [...new Set([...array<number>(tx.rosterIdsInvolved), ...Object.values(adds), ...Object.values(drops), ...picks.flatMap((p) => [p.owner_id, p.previous_owner_id])])];
    const sides = rosterIds.map((rosterId) => {
      const gotPlayers = Object.entries(adds).filter(([, owner]) => owner === rosterId).map(([id]) => playerAsset(id, tx.sleeperCreatedAt));
      const gavePlayers = Object.entries(drops).filter(([, owner]) => owner === rosterId).map(([id]) => playerAsset(id, tx.sleeperCreatedAt));
      const gotPicks: Asset[] = picks.filter((p) => p.owner_id === rosterId).map((p) => ({ id: null, label: `${p.season} Round ${p.round} · ${teamName(p.roster_id)} original`, atMove: null, current: pickValues.get(`pick:${p.season}:${p.round}:${p.roster_id}`) ?? null }));
      const gavePicks: Asset[] = picks.filter((p) => p.previous_owner_id === rosterId).map((p) => ({ id: null, label: `${p.season} Round ${p.round} · ${teamName(p.roster_id)} original`, atMove: null, current: pickValues.get(`pick:${p.season}:${p.round}:${p.roster_id}`) ?? null }));
      return { rosterId, name: teamName(rosterId), got: [...gotPlayers, ...gotPicks], gave: [...gavePlayers, ...gavePicks] };
    }).filter((side) => side.got.length || side.gave.length);
    return { tx, sides, bid: waiverBid(tx.rawPayload), faab: array<FaabTransfer>(tx.waiverBudget).filter((row) => Number(row.amount) > 0) };
  });

  const renderAsset = (item: Asset, tone: "got" | "gave") => <li key={`${tone}:${item.label}`} className="rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-2">
    <div className={`text-xs font-medium ${tone === "got" ? "text-emerald-300" : "text-red-300"}`}>{item.id ? <Link href={`/players/${item.id}`} className="hover:text-white">{item.label}</Link> : item.label}</div>
    {item.atMove !== null || item.current !== null ? <div className="mt-1 text-xs text-neutral-400">at move {formatPoints(item.atMove)} · now {formatPoints(item.current)}{item.atMove !== null && item.current !== null ? <span className={`ml-1 ${trendColorClass(item.current - item.atMove)}`}>({formatSigned(item.current - item.atMove)})</span> : null}</div> : null}
  </li>;

  return <div className="space-y-4">
    <header><h1 className="text-xl font-semibold text-neutral-100">Transactions</h1><p className="mt-1 text-sm text-neutral-400">The synced Sleeper ledger. Each trade asset appears once, under the team that gave or received it.</p></header>
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex gap-1">{([["all", "All"], ["trade", "Trades"], ["moves", "Adds / waivers"]] as const).map(([key, label]) => <Link key={key} href={href(key, 1)} className={`rounded-md px-3 py-2 text-xs ${filter === key ? "bg-neutral-700 text-white" : "border border-neutral-800 bg-neutral-900 text-neutral-400"}`}>{label}</Link>)}</div><span className="text-xs text-neutral-400">{total.toLocaleString("en-US")} matching · page {page}/{totalPages}</span></div>
    <div className="space-y-3">{rows.map(({ tx, sides, bid, faab }) => <article key={tx.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3"><span className="rounded bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-200">{tx.type === "trade" ? "Trade" : tx.type === "waiver" ? "Waiver claim" : tx.type === "free_agent" ? "Free agent" : "Roster move"}</span><time className="text-xs text-neutral-400">{formatDateTimeEastern(tx.sleeperCreatedAt.toISOString())}</time></div>
      {bid !== null ? <p className="mb-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300">FAAB bid: <strong>${bid}</strong> of the original $100 budget</p> : null}
      {faab.length ? <p className="mb-3 rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">FAAB transfer: {faab.map((row) => `${teamName(row.sender)} → ${teamName(row.receiver)} $${row.amount}`).join(" · ")}</p> : null}
      <div className="space-y-3">{sides.map((side) => <section key={side.rosterId} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3"><h2 className="mb-2 text-sm font-semibold text-neutral-100">{side.name}</h2><div className="grid gap-3 md:grid-cols-2"><div><h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-300">Gave</h3><ul className="space-y-1.5">{side.gave.length ? side.gave.map((item) => renderAsset(item, "gave")) : <li className="text-xs text-neutral-500">Nothing recorded</li>}</ul></div><div><h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-300">Got</h3><ul className="space-y-1.5">{side.got.length ? side.got.map((item) => renderAsset(item, "got")) : <li className="text-xs text-neutral-500">Nothing recorded</li>}</ul></div></div></section>)}</div>
    </article>)}</div>
    {totalPages > 1 ? <nav className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 p-3"><Link href={href(filter, Math.max(1, page - 1))} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none text-neutral-600" : "text-neutral-200"}>← Newer</Link><span className="text-xs text-neutral-400">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span><Link href={href(filter, Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} className={page >= totalPages ? "pointer-events-none text-neutral-600" : "text-neutral-200"}>Older →</Link></nav> : null}
  </div>;
}
