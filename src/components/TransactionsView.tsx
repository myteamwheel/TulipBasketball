import { verifiedRetirement } from "@/lib/verifiedRetirements";
import { fetchStatsGuyCurrentSnapshot, withStatsGuyCurrentFallback } from "@/lib/currentTradeValues";
import matchupData from "@/data/trade-matchups.json";
import { tradeOnField, type MatchupWeek } from "@/lib/tradeOnField";
import statsGuyArchive from "@/data/statsguy-historical-trades.json";
import recoveredJson from "@/data/trade-chart-prices.json";
import type { RecoveredTradePrices } from "@/lib/historicalKtc";
import { getLeagueHistory, getFrozenTradePrices } from "@/lib/leagueHistory";
import { historicalManager, resolveDraftPick } from "@/lib/tradeLineage";
import type { ReviewAsset, ReviewTrade } from "@/lib/tradeReview";
import TradeReviewCard from "@/components/TradeReviewCard";
import TradeReviewBoard from "@/components/TradeReviewBoard";
import { historicalPickSnapshots } from "@/lib/pickFreshness";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { computeMarketDataForPlayers, getObservationSeries } from "@/lib/metrics";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { publicTeamName } from "@/lib/publicIdentity";
import { formatDateTimeEastern, formatPoints, formatSigned, trendColorClass } from "@/lib/format";
import { fetchFreshDraftPickMarketValues } from "@/lib/pickMarket";
import { currentPickMarketValue } from "@/lib/pickValuation";
import { calculateTradeSideGrades, selectTradeSnapshot, TRADE_SNAPSHOT_WINDOW_MS, type TradeGradeAsset, type TradeSnapshotTiming } from "@/lib/tradeGrades";
import { faabForRoster, parseFaabTransfers } from "@/lib/tradeFaab";



const PAGE_SIZE = 15;
type TxFilter = "all" | "trade" | "moves";
type TradedPick = { season: string; round: number; roster_id: number; previous_owner_id: number; owner_id: number };
type Asset = TradeGradeAsset & { statsGuyValue?: number | null; sleeperId?: string } & Pick<ReviewAsset, "outcome" | "journey" | "priceSource" | "historicalDaily" | "retiredSource"> & { playerId: string | null; atMoveObservedAt: Date | null; atMoveTiming: TradeSnapshotTiming | null; currentObservedAt: string | null };

const recovered = recoveredJson as RecoveredTradePrices;
const statsGuyHistory = statsGuyArchive as Record<string, { date: string; values: Record<string, number> }>;
const HISTORICAL_MARKET_WINDOW_MS = TRADE_SNAPSHOT_WINDOW_MS;

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
  try { const rawValue = (JSON.parse(raw) as { settings?: { waiver_bid?: unknown } }).settings?.waiver_bid; const value = Number(rawValue); return rawValue != null && Number.isFinite(value) && value >= 0 ? value : null; } catch { return null; }
}
export default async function TransactionsPage({ searchParams, review = false }: { searchParams: Promise<{ type?: string; page?: string; trade?: string }>; review?: boolean }) {
  const params = await searchParams;
  const filter: TxFilter = review ? "trade" : params.type === "trade" ? "trade" : params.type === "moves" ? "moves" : "all";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const where: Prisma.TransactionWhereInput = { league: { sleeperId: SLEEPER_LEAGUE_ID }, ...(filter === "trade" ? { type: "trade" } : filter === "moves" ? { type: { not: "trade" } } : {}) };
  const total = await prisma.transaction.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const [storedTransactions, managers, pickMarket, statsGuyCurrent] = await Promise.all([
    prisma.transaction.findMany({ where, orderBy: { sleeperCreatedAt: "desc" }, ...(review ? {} : { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }) }),
    prisma.manager.findMany({ where: { league: { sleeperId: SLEEPER_LEAGUE_ID } } }),
    fetchFreshDraftPickMarketValues().catch(() => []),
    review ? fetchStatsGuyCurrentSnapshot() : Promise.resolve(null),
  ]);
  const [history, frozenPrices] = await Promise.all([getLeagueHistory(), getFrozenTradePrices()]);
  const currentLeague = history.seasons.find(s => s.leagueId === SLEEPER_LEAGUE_ID);
  const currentManagerByOwner = new Map(managers.map(m => [m.sleeperUserId, m]));
  const identityKeys = [...new Set(history.seasons.flatMap(s => s.managers.map(m => historicalManager(history, s.leagueId, m.rosterId).key)))].sort();
  const identityNumber = (leagueId: string, rosterId: number) => {
    const owner = historicalManager(history, leagueId, rosterId);
    const current = currentManagerByOwner.get(owner.key.replace(/^owner:/, ''));
    return current?.sleeperRosterId ?? -(identityKeys.indexOf(owner.key) + 1);
  };
  const transactionLeague = new Map(storedTransactions.map(t => [t.sleeperTransactionId, SLEEPER_LEAGUE_ID]));
  const allTransactions = new Map(storedTransactions.map(t => [t.sleeperTransactionId, t]));
  if (review) for (const season of history.seasons) for (const tx of season.trades) {
    transactionLeague.set(tx.transaction_id, season.leagueId);
    if (!allTransactions.has(tx.transaction_id)) allTransactions.set(tx.transaction_id, {
      id: 'sleeper-' + tx.transaction_id, leagueId: season.leagueId, sleeperTransactionId: tx.transaction_id,
      type: tx.type, status: tx.status, sleeperCreatedAt: new Date(tx.created),
      rosterIdsInvolved: JSON.stringify(tx.roster_ids ?? []), adds: JSON.stringify(tx.adds), drops: JSON.stringify(tx.drops),
      draftPicks: JSON.stringify(tx.draft_picks ?? []), waiverBudget: JSON.stringify(tx.waiver_budget ?? []), rawPayload: JSON.stringify(tx), processedAt: new Date(season.checkedAt),
    });
  }
  const transactions = [...allTransactions.values()].sort((a,b) => b.sleeperCreatedAt.getTime() - a.sleeperCreatedAt.getTime());
  const rangeStart = transactions.length
    ? new Date(Math.min(...transactions.map((tx) => tx.sleeperCreatedAt.getTime())) - HISTORICAL_MARKET_WINDOW_MS)
    : null;
  const rangeEnd = transactions.length
    ? new Date(Math.max(...transactions.map((tx) => tx.sleeperCreatedAt.getTime())) + HISTORICAL_MARKET_WINDOW_MS)
    : null;
  const refreshRuns = rangeStart && rangeEnd
    ? await prisma.refreshRun.findMany({
        where: {
          league: { sleeperId: SLEEPER_LEAGUE_ID },
          summary: { not: null },
          startedAt: { gte: rangeStart, lte: rangeEnd },
        },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true, finishedAt: true, summary: true },
      })
    : [];
  const sleeperIds = [...new Set([...transactions.flatMap((tx) => [...Object.keys(record(tx.adds)), ...Object.keys(record(tx.drops))]), ...history.seasons.flatMap(s => s.drafts.flatMap(d => d.picks.map(p => p.playerId)))])];
  const players = await prisma.player.findMany({ where: { sleeperId: { in: sleeperIds } }, select: { id: true, sleeperId: true, fullName: true, position: true, nflTeam: true } });
  const [series, currentMarket] = await Promise.all([getObservationSeries(players.map((p) => p.id)), computeMarketDataForPlayers(players.map((p) => p.id))]);
  const managerByRoster = new Map(managers.map((m) => [m.sleeperRosterId, m]));
  const playerBySleeper = new Map(players.map((p) => [p.sleeperId, p]));
  const pickSnapshots = historicalPickSnapshots(refreshRuns);
  let activeLeagueId = SLEEPER_LEAGUE_ID;
  let activeTransactionId = '';
  const teamName = (rosterId: number) => {
    if (activeLeagueId === SLEEPER_LEAGUE_ID && managerByRoster.has(rosterId)) return publicTeamName(managerByRoster.get(rosterId)!);
    return historicalManager(history, activeLeagueId, rosterId).name;
  };

  function playerAsset(sleeperId: string, date: Date): Asset {
    const player = playerBySleeper.get(sleeperId);
    const retiredSource = verifiedRetirement(sleeperId, player?.nflTeam);
    const daily = recovered.prices[activeTransactionId]?.["player:" + sleeperId];
    const statsGuyValue = statsGuyHistory[activeTransactionId]?.values[sleeperId] ?? null;
    if (!player) return { id: `player:${sleeperId}`, sleeperId, playerId: null, label: history.players[sleeperId] ? `${history.players[sleeperId].name} (${history.players[sleeperId].position})` : `Sleeper player ${sleeperId}`, assetType: "player", atTradeValue: daily?.value ?? null, statsGuyValue, historicalDaily: daily, currentValue: retiredSource ? 0 : null, currentValueIsRetired: !!retiredSource, retiredSource, currentObservedAt: null, atMoveObservedAt: null, atMoveTiming: null };
    const atMove = selectTradeSnapshot(
      series.get(player.id) ?? [],
      date,
      (observation) => observation.validationStatus === "VALID",
    );
    const market = currentMarket.get(player.id);
    const frozen = frozenPrices.get(activeTransactionId)?.[player.id];
    const retiredEstimate = !!retiredSource && (!market || market.isStale || market.currentValue === null);
    return {
      id: player.id,
      sleeperId,
      playerId: player.id,
      label: `${player.fullName} (${player.position})`,
      assetType: "player",
      atTradeValue: frozen?.value ?? atMove?.snapshot.value ?? daily?.value ?? null,
      statsGuyValue,
      historicalDaily: !frozen && !atMove ? daily : undefined,
      currentValue: market && !market.isStale && market.currentValue !== null ? market.currentValue : retiredEstimate ? 0 : null,
      currentValueIsRetired: retiredEstimate,
      retiredSource: retiredEstimate ? retiredSource : undefined,
      currentObservedAt: market && !market.isStale ? market.currentObservedAt : null,
      atMoveObservedAt: frozen ? new Date(frozen.observedAt) : atMove?.snapshot.observedAt ?? null,
      atMoveTiming: frozen?.timing ?? atMove?.timing ?? null,
      priceSource: frozen ? "Preserved KTC observation" : "Verified KTC observation",
    };
  }
  function pickAsset(pick: TradedPick, date: Date): Asset {
    const snapshot = selectTradeSnapshot(pickSnapshots, date, snapshot => currentPickMarketValue(snapshot.rows, Number(pick.season), pick.round, null) !== null);
    const atTradeValue = snapshot
      ? currentPickMarketValue(snapshot.snapshot.rows, Number(pick.season), pick.round, null)
      : null;
    const resolution = resolveDraftPick(history, pick.season, pick.round, pick.roster_id);
    const drafted = resolution ? playerBySleeper.get(resolution.playerId) : null;
    const draftedMarket = drafted ? currentMarket.get(drafted.id) : null;
    const draftedRetirement = resolution ? verifiedRetirement(resolution.playerId, drafted?.nflTeam) : undefined;
    const draftedRetiredEstimate = !!draftedRetirement && (!draftedMarket || draftedMarket.isStale || draftedMarket.currentValue === null);
    const frozen = frozenPrices.get(activeTransactionId)?.[`pick:${pick.season}:${pick.round}:${pick.roster_id}`];
    const daily = recovered.prices[activeTransactionId]?.[`pick:${pick.season}:${pick.round}:${pick.roster_id}`];
    const currentValue = resolution ? null : currentPickMarketValue(pickMarket, Number(pick.season), pick.round, null);
    const currentObservedAt = currentValue === null ? null : pickMarket.filter(row => Number(row.season) === Number(pick.season) && row.round === pick.round).map(row => row.sourceUpdatedAt).filter(Boolean).sort()[0] ?? null;
    return {
      id: `pick:${pick.season}:${pick.round}:${pick.roster_id}`,
      playerId: null,
      label: `${pick.season} Round ${pick.round} · ${teamName(pick.roster_id)} original`,
      assetType: "pick",
      atTradeValue: frozen?.value ?? atTradeValue ?? daily?.value ?? null,
      statsGuyValue: statsGuyHistory[activeTransactionId]?.values[`pick:${pick.season}:${pick.round}`] ?? null,
      historicalDaily: !frozen && atTradeValue === null ? daily : undefined,
      currentValue,
      outcome: resolution ? { label: resolution.name, playerId: drafted?.id ?? null, sleeperId: resolution.playerId, pickNumber: resolution.overall, currentValue: draftedMarket && !draftedMarket.isStale && draftedMarket.currentValue !== null ? draftedMarket.currentValue : draftedRetiredEstimate ? 0 : null, currentValueIsRetired: draftedRetiredEstimate, retiredSource: draftedRetiredEstimate ? draftedRetirement : undefined, sourceUrl: `https://sleeper.com/draft/nfl/${resolution.draftId}` } : undefined,
      priceSource: 'Generic round-level pick market',
      currentObservedAt,
      atMoveObservedAt: frozen ? new Date(frozen.observedAt) : snapshot?.snapshot.observedAt ?? null,
      atMoveTiming: frozen?.timing ?? snapshot?.timing ?? null,
    };
  }
  const rows = transactions.map((tx) => {
    activeLeagueId = transactionLeague.get(tx.sleeperTransactionId) ?? SLEEPER_LEAGUE_ID;
    activeTransactionId = tx.sleeperTransactionId;
    const adds = record(tx.adds), drops = record(tx.drops), picks = array<TradedPick>(tx.draftPicks);
    const faab = parseFaabTransfers(tx.waiverBudget);
    const rosterIds = [...new Set([...array<number>(tx.rosterIdsInvolved), ...Object.values(adds), ...Object.values(drops), ...picks.flatMap((p) => [p.owner_id, p.previous_owner_id]), ...faab.flatMap(p => [p.sender, p.receiver])])];
    let sides = rosterIds.map((rosterId) => {
      const gotPlayers = Object.entries(adds).filter(([, owner]) => owner === rosterId).map(([id]) => playerAsset(id, tx.sleeperCreatedAt));
      const gavePlayers = Object.entries(drops).filter(([, owner]) => owner === rosterId).map(([id]) => playerAsset(id, tx.sleeperCreatedAt));
      const gotPicks = picks.filter((p) => p.owner_id === rosterId).map((p) => pickAsset(p, tx.sleeperCreatedAt));
      const gavePicks = picks.filter((p) => p.previous_owner_id === rosterId).map((p) => pickAsset(p, tx.sleeperCreatedAt));
      const gave = [...gavePlayers, ...gavePicks], got = [...gotPlayers, ...gotPicks];
      const budget = faabForRoster(faab, rosterId);
      return {
        rosterId: review ? identityNumber(activeLeagueId, rosterId) : rosterId,
        identityKey: historicalManager(history, activeLeagueId, rosterId).key,
        onFieldCheckedAt: matchupData.checkedAt,
        onField: review && tx.type === "trade" ? tradeOnField(matchupData.weeks as MatchupWeek[], activeLeagueId, tx.sleeperCreatedAt.getTime(), rosterId, Object.entries(adds).filter(([, owner]) => owner === rosterId).map(([id]) => id)) : null,
        name: teamName(rosterId),
        got,
        gave,
        ...budget,
        grades: tx.type === "trade"
          ? calculateTradeSideGrades({ gave, got, ...budget })
          : null,
      };
    }).filter((side) => side.got.length || side.gave.length || (side.faabSent ?? 0) > 0 || (side.faabReceived ?? 0) > 0);
    const providerDate = statsGuyHistory[activeTransactionId]?.date;
    const assets = sides.flatMap(side => [...side.got, ...side.gave]);
    const canUseStatsGuy = !!providerDate && assets.length > 0 && assets.every(asset => asset.statsGuyValue != null && asset.statsGuyValue > 0);
    if (tx.type === "trade" && canUseStatsGuy && sides.some(side => (side.grades?.atTrade.missingAssets.length ?? 0) > 0)) {
      const convert = (asset: Asset): Asset => ({
        ...asset,
        atTradeValue: asset.statsGuyValue ?? null,
        historicalDaily: { value: asset.statsGuyValue!, date: providerDate!, method: "STATSGUY_HISTORY", sourceUrls: ["https://statsguyfantasy.com/"] },
        atMoveObservedAt: null,
        atMoveTiming: null,
      });
      sides = sides.map(side => {
        const got = side.got.map(convert), gave = side.gave.map(convert);
        return { ...side, got, gave, grades: calculateTradeSideGrades({ got, gave, faabSent: side.faabSent, faabReceived: side.faabReceived }) };
      });
    }
    return { tx, sides, bid: waiverBid(tx.rawPayload), faab };
  });

  if (review) {
    const trades: ReviewTrade[] = rows.map(({ tx, sides }) => ({
      id: tx.id,
      date: tx.sleeperCreatedAt.toISOString(),
      season: history.seasons.find(s => s.leagueId === transactionLeague.get(tx.sleeperTransactionId))?.season ?? currentLeague?.season,
      sides: sides.map(side => ({
        ...side,
        gave: side.gave.map(asset => ({ ...asset, atMoveObservedAt: asset.atMoveObservedAt?.toISOString() ?? null })),
        got: side.got.map(asset => ({ ...asset, atMoveObservedAt: asset.atMoveObservedAt?.toISOString() ?? null })),
      })),
    })).map(trade => withStatsGuyCurrentFallback(trade, statsGuyCurrent));
    for (const trade of trades) for (const side of trade.sides) for (const asset of side.got) {
      const later = trades.filter(next => next.date > trade.date && next.sides.some(s => s.got.some(a => a.id === asset.id || (asset.outcome?.playerId && a.playerId === asset.outcome.playerId)))).sort((a,b) => a.date.localeCompare(b.date));
      asset.journey = later.map(next => ({ tradeId: next.id, date: next.date, label: next.sides.map(s => s.name).join(' ↔ ') }));
    }
    return <TradeReviewBoard trades={trades} initialTrade={params.trade} historyCoverage={history.seasons.map(s => ({ season: s.season, complete: s.complete, trades: trades.filter(t => t.season === s.season).length }))} checkedAt={history.checkedAt} chainComplete={history.chainComplete} />;
  }

  const renderAsset = (item: Asset, tone: "got" | "gave") => <li key={`${tone}:${item.label}`} className="rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-2">
    <div className={`text-xs font-medium ${tone === "got" ? "text-emerald-300" : "text-red-300"}`}>{item.playerId ? <Link href={`/players/${item.playerId}`} className="hover:text-white">{item.label}</Link> : item.label}</div>
    {item.atTradeValue !== null || item.currentValue !== null ? <div className="mt-1 text-xs text-neutral-400">at transaction {formatPoints(item.atTradeValue)}{item.atMoveObservedAt ? ` (${formatDateTimeEastern(item.atMoveObservedAt.toISOString())})` : ""}{item.atMoveTiming === "NEXT_DAY_APPROXIMATION" ? " · next-day approximation" : ""} · now {formatPoints(item.currentValue)}{item.atTradeValue !== null && item.currentValue !== null ? <span className={`ml-1 ${trendColorClass(item.currentValue - item.atTradeValue)}`}>({formatSigned(item.currentValue - item.atTradeValue)})</span> : null}</div> : null}
  </li>;

  return <div className="space-y-4">
    <header><h1 className="text-xl font-semibold text-neutral-100">{review ? "Trade Review" : "Transactions"}</h1><p className="mt-1 text-sm text-neutral-400">{review ? "Who received what, who had the market edge then, and how the original deal looks now." : "The synced Sleeper ledger: trades, free-agent moves, and waiver claims."}</p></header>
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex gap-1">{(!review ? [["all", "All"], ["trade", "Trades"], ["moves", "Adds / waivers"]] as const : []).map(([key, label]) => <Link key={key} href={href(key, 1)} className={`rounded-md px-3 py-2 text-xs ${filter === key ? "bg-neutral-700 text-white" : "border border-neutral-800 bg-neutral-900 text-neutral-400"}`}>{label}</Link>)}</div><span className="text-xs text-neutral-400">{total.toLocaleString("en-US")} matching · page {page}/{totalPages}</span></div>
    {!rows.length ? <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No matching transactions have been synced yet.</p> : null}
    <div className="space-y-3">{rows.map(({ tx, sides, bid, faab }) => <article key={tx.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3"><span className="rounded bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-200">{tx.type === "trade" ? "Trade" : tx.type === "waiver" ? "Waiver claim" : tx.type === "free_agent" ? "Free agent" : "Roster move"}</span><time className="text-xs text-neutral-400">{formatDateTimeEastern(tx.sleeperCreatedAt.toISOString())}</time></div>
      {bid !== null ? <p className="mb-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300">FAAB spent: <strong>${bid}</strong></p> : null}
      {faab.length ? <p className="mb-3 rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">FAAB transfer: {faab.map((row) => `${teamName(row.sender)} → ${teamName(row.receiver)} $${row.amount}`).join(" · ")}</p> : null}
      {tx.type === "trade" && sides.length ? <TradeReviewCard sides={sides.map(side => ({ ...side, gave: side.gave.map(asset => ({...asset, atMoveObservedAt: asset.atMoveObservedAt?.toISOString() ?? null})), got: side.got.map(asset => ({...asset, atMoveObservedAt: asset.atMoveObservedAt?.toISOString() ?? null})) }))} /> : null}
      {tx.type !== "trade" ? <div className="space-y-3">{(tx.type === "trade" && sides.length === 2 ? sides.slice(0, 1) : sides).map((side) => <section key={side.rosterId} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3"><h2 className="mb-2 text-sm font-semibold text-neutral-100">{side.name}{tx.type === "trade" && sides.length === 2 ? ` ↔ ${sides[1].name}` : ""}</h2><div className="grid gap-3 md:grid-cols-2">{!(tx.type === "trade" && sides.length > 2) && <div><h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-300">{tx.type === "trade" && sides.length === 2 ? `${side.name} gave` : "Gave"}</h3><ul className="space-y-1.5">{side.gave.length ? side.gave.map((item) => renderAsset(item, "gave")) : <li className="text-xs text-neutral-500">{tx.type === "trade" && faab.length ? "FAAB transfer listed above" : "Nothing recorded"}</li>}</ul></div>}<div><h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-300">{tx.type === "trade" && sides.length === 2 ? `${side.name} got` : "Got"}</h3><ul className="space-y-1.5">{side.got.length ? side.got.map((item) => renderAsset(item, "got")) : <li className="text-xs text-neutral-500">{tx.type === "trade" && faab.length ? "FAAB transfer listed above" : "Nothing recorded"}</li>}</ul></div></div></section>)}</div> : null}
    </article>)}</div>
    {totalPages > 1 ? <nav className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 p-3"><Link href={review ? `/trade-review?page=${Math.max(1, page - 1)}` : href(filter, Math.max(1, page - 1))} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none text-neutral-600" : "text-neutral-200"}>← Newer</Link><span className="text-xs text-neutral-400">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span><Link href={review ? `/trade-review?page=${Math.min(totalPages, page + 1)}` : href(filter, Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} className={page >= totalPages ? "pointer-events-none text-neutral-600" : "text-neutral-200"}>Older →</Link></nav> : null}
  </div>;
}
