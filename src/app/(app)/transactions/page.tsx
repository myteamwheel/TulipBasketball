import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getObservationSeries, closestObservation } from "@/lib/metrics";
import { fetchFreshDraftPickMarketValues } from "@/lib/pickMarket";
import { calculatePackageTradeValue } from "@/lib/tradeValue";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { formatDateTimeEastern, formatPoints, formatSigned, trendColorClass } from "@/lib/format";

const TYPE_LABEL: Record<string, string> = {
  trade: "Trade",
  waiver: "Waiver claim",
  free_agent: "Free agent",
  commissioner: "Commissioner move",
};

type TradedPick = {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
};

function moveGrade(net: number | null) {
  if (net === null) return null;
  if (net >= 1200) return "A";
  if (net >= 400) return "B";
  if (net >= -300) return "C";
  if (net >= -1000) return "D";
  return "F";
}

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const [transactions, managers, players, pickMarket] = await Promise.all([
    prisma.transaction.findMany({
      where: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
      orderBy: { sleeperCreatedAt: "desc" },
      take: 75,
    }),
    prisma.manager.findMany({ where: { league: { sleeperId: SLEEPER_LEAGUE_ID } } }),
    prisma.player.findMany({ select: { id: true, sleeperId: true, fullName: true, position: true } }),
    fetchFreshDraftPickMarketValues().catch(() => []),
  ]);

  const managerByRosterId = new Map(managers.map((manager) => [manager.sleeperRosterId, manager]));
  const playerBySleeperId = new Map(players.map((player) => [player.sleeperId, player]));
  const series = await getObservationSeries(players.map((player) => player.id));
  const pickMarketAvailable = pickMarket.length > 0;

  function managerName(rosterId: number) {
    const manager = managerByRosterId.get(rosterId);
    return manager?.teamName ?? manager?.displayName ?? `Roster ${rosterId}`;
  }

  function playerAsset(sleeperPid: string, rosterId: number, txDate: Date, kind: "add" | "drop") {
    const player = playerBySleeperId.get(sleeperPid);
    if (!player) {
      return {
        assetType: "player" as const,
        label: `Unmapped player (${sleeperPid})`,
        managerName: managerName(rosterId),
        rosterId,
        valueAtTx: null,
        currentValue: null,
        playerId: null,
        kind,
        valueAtTxApprox: false,
      };
    }

    const observations = series.get(player.id) ?? [];
    const atTx = closestObservation(observations, txDate, "before") ?? closestObservation(observations, txDate, "after");
    const latest = observations.filter((observation) => observation.validationStatus === "VALID").slice(-1)[0] ?? null;
    return {
      assetType: "player" as const,
      label: `${player.fullName} (${player.position})`,
      managerName: managerName(rosterId),
      rosterId,
      valueAtTx: atTx?.value ?? null,
      valueAtTxApprox: !!atTx && atTx.observedAt.getTime() !== txDate.getTime(),
      currentValue: latest?.value ?? null,
      playerId: player.id,
      kind,
    };
  }

  function currentPickValue(season: string, round: number) {
    const matching = pickMarket.filter((pick) => pick.season === String(season) && pick.round === Number(round));
    const generic = matching.find((pick) => pick.slot === null);
    if (generic) return { value: generic.value, label: generic.label };
    if (!matching.length) return { value: null, label: null };
    return {
      value: Math.round(matching.reduce((sum, pick) => sum + pick.value, 0) / matching.length),
      label: `${season} R${round} neutral current value`,
    };
  }

  const rows = transactions.map((transaction) => {
    const adds = transaction.adds ? (JSON.parse(transaction.adds) as Record<string, number>) : {};
    const drops = transaction.drops ? (JSON.parse(transaction.drops) as Record<string, number>) : {};
    const draftPicks = transaction.draftPicks ? (JSON.parse(transaction.draftPicks) as TradedPick[]) : [];
    const playerAdds = Object.entries(adds).map(([pid, rosterId]) => playerAsset(pid, rosterId, transaction.sleeperCreatedAt, "add"));
    const playerDrops = Object.entries(drops).map(([pid, rosterId]) => playerAsset(pid, rosterId, transaction.sleeperCreatedAt, "drop"));
    const pickAssets = draftPicks.map((pick) => {
      const market = currentPickValue(pick.season, pick.round);
      return {
        assetType: "pick" as const,
        label: `${pick.season} Round ${pick.round} pick`,
        managerName: managerName(pick.owner_id),
        rosterId: pick.owner_id,
        previousManagerName: managerName(pick.previous_owner_id),
        valueAtTx: null,
        valueAtTxApprox: false,
        currentValue: market.value,
        playerId: null,
        kind: "add" as const,
        marketLabel: market.label,
      };
    });
    const assets = [...playerAdds, ...playerDrops, ...pickAssets];

    const tradeSides = [...new Set(
      transaction.rosterIdsInvolved ? (JSON.parse(transaction.rosterIdsInvolved) as number[]) : [],
    )]
      .map((rosterId) => {
        const acquiredPlayers = playerAdds.filter((asset) => asset.rosterId === rosterId);
        const acquiredPicks = pickAssets.filter((asset) => asset.rosterId === rosterId);
        const acquired = [...acquiredPlayers, ...acquiredPicks];
        const currentKnown = acquired.filter((asset) => asset.currentValue !== null);
        const complete = acquired.length > 0 && currentKnown.length === acquired.length;
        const rawTotal = currentKnown.reduce((sum, asset) => sum + (asset.currentValue ?? 0), 0);
        const packageValue = complete
          ? calculatePackageTradeValue(currentKnown.map((asset) => ({
              value: asset.currentValue ?? 0,
              assetType: asset.assetType,
              name: asset.label,
            })))
          : null;

        return {
          rosterId,
          name: managerName(rosterId),
          rawTotal,
          adjustedTotal: packageValue?.adjustedValue ?? null,
          packageAdjustment: packageValue?.consolidationAdjustment ?? null,
          covered: currentKnown.length,
          totalAssets: acquired.length,
          complete,
        };
      })
      .filter((side) => side.totalAssets > 0);

    const tradeCoverageComplete = tradeSides.length >= 2 && tradeSides.every((side) => side.complete && side.adjustedTotal !== null);
    const sortedSides = tradeCoverageComplete
      ? [...tradeSides].sort((a, b) => (b.adjustedTotal ?? 0) - (a.adjustedTotal ?? 0))
      : [];
    const currentWinner = transaction.type === "trade" && sortedSides.length >= 2 ? sortedSides[0] : null;
    const runnerUp = currentWinner ? sortedSides[1] : null;

    const rosterMoveAssets = [...playerAdds, ...playerDrops];
    const moveCoverageComplete = rosterMoveAssets.length > 0 && rosterMoveAssets.every((asset) => asset.valueAtTx !== null);
    const addAtTx = moveCoverageComplete ? playerAdds.reduce((sum, asset) => sum + (asset.valueAtTx ?? 0), 0) : 0;
    const dropAtTx = moveCoverageComplete ? playerDrops.reduce((sum, asset) => sum + (asset.valueAtTx ?? 0), 0) : 0;
    const rosterMoveNet = transaction.type !== "trade" && moveCoverageComplete ? addAtTx - dropAtTx : null;

    return {
      ...transaction,
      assets,
      tradeSides,
      tradeCoverageComplete,
      currentWinner,
      runnerUp,
      rosterMoveNet,
      rosterMoveGrade: moveGrade(rosterMoveNet),
      moveCoverageComplete,
    };
  });

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Transactions</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
          Historical player value uses the nearest stored KTC observation. Current trade audits require complete asset coverage and use consolidation-adjusted package value instead of simple addition.
        </p>
      </div>

      {!pickMarketAvailable ? (
        <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-[10px] leading-4 text-amber-300">
          A fresh current draft-pick market could not be verified. Trades containing picks therefore remain incomplete rather than assigning stale or invented pick values.
        </div>
      ) : null}

      <div className="space-y-3">
        {rows.map((transaction) => (
          <article key={transaction.id} className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-3 text-[10px] text-neutral-600">
              <span className="rounded bg-neutral-800 px-2 py-1 font-medium text-neutral-300">{TYPE_LABEL[transaction.type] ?? transaction.type}</span>
              <span className="shrink-0 text-right">{formatDateTimeEastern(transaction.sleeperCreatedAt.toISOString())}</span>
            </div>

            {transaction.type === "trade" && transaction.tradeSides.length >= 2 ? (
              <div className="mb-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Current trade audit · consolidation adjusted</span>
                  {transaction.tradeCoverageComplete && transaction.currentWinner && transaction.runnerUp ? (
                    <span className="text-[10px] text-emerald-300">
                      Complete coverage · adjusted edge {formatSigned((transaction.currentWinner.adjustedTotal ?? 0) - (transaction.runnerUp.adjustedTotal ?? 0))}
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-300">Incomplete coverage · no leader declared</span>
                  )}
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {transaction.tradeSides.map((side) => (
                    <div key={side.rosterId} className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-3 rounded-md bg-neutral-900 px-3 py-2">
                      <span className="min-w-0 truncate text-xs text-neutral-300">{side.name}</span>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold tabular-nums text-neutral-100">
                          {side.adjustedTotal !== null ? formatPoints(side.adjustedTotal) : "—"}
                        </div>
                        <div className="text-[9px] text-neutral-600">adjusted · raw {formatPoints(side.rawTotal)}</div>
                        <div className={`text-[9px] ${side.complete ? "text-neutral-700" : "text-amber-500"}`}>
                          {side.covered}/{side.totalAssets} assets valued{side.packageAdjustment ? ` · −${formatPoints(side.packageAdjustment)} package adj.` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {transaction.tradeCoverageComplete && transaction.currentWinner ? (
                  <p className="mt-2 text-[10px] leading-4 text-neutral-500">
                    Current adjusted-value leader: <span className="font-medium text-emerald-300">{transaction.currentWinner.name}</span>. Raw totals remain visible for audit. This is a current market comparison, not a judgment of the decision at the original trade date.
                  </p>
                ) : (
                  <p className="mt-2 text-[10px] leading-4 text-neutral-500">
                    At least one acquired asset lacks a current verified value. Missing value is never treated as zero, so the dashboard withholds a winner.
                  </p>
                )}
              </div>
            ) : null}

            {transaction.type !== "trade" ? (
              transaction.rosterMoveNet !== null ? (
                <div className="mb-3 flex min-w-0 items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs">
                  <span className="min-w-0 text-neutral-500">Move value at nearest stored KTC snapshot</span>
                  <span className={`shrink-0 ${trendColorClass(transaction.rosterMoveNet)}`}><strong>{transaction.rosterMoveGrade}</strong> · {formatSigned(transaction.rosterMoveNet)}</span>
                </div>
              ) : transaction.assets.length ? (
                <div className="mb-3 rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[10px] leading-4 text-amber-300">
                  No move grade: at least one added/dropped player has no usable KTC observation near the transaction date.
                </div>
              ) : null
            ) : null}

            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              {transaction.assets.map((asset, index) => (
                <div key={index} className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-3 rounded-md bg-neutral-950 px-3 py-2">
                  <div className="min-w-0">
                    <div className="min-w-0 truncate text-xs">
                      <span className={asset.kind === "add" ? "text-emerald-400" : "text-red-400"}>{asset.kind === "add" ? "+ " : "− "}</span>
                      {asset.playerId ? <Link href={`/players/${asset.playerId}`} className="text-neutral-100 hover:text-emerald-300">{asset.label}</Link> : <span className="text-neutral-100">{asset.label}</span>}
                    </div>
                    <div className="mt-0.5 truncate text-[9px] text-neutral-600">
                      {asset.managerName}{asset.assetType === "pick" && "previousManagerName" in asset ? ` · from ${asset.previousManagerName}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[10px]">
                    {asset.assetType === "player" ? (
                      <>
                        <div className="text-neutral-500">at move {formatPoints(asset.valueAtTx)}{asset.valueAtTxApprox ? <span className="text-neutral-700"> · nearest</span> : null}</div>
                        {asset.currentValue !== null && asset.valueAtTx !== null ? (
                          <div className={trendColorClass(asset.currentValue - asset.valueAtTx)}>now {formatPoints(asset.currentValue)} · {formatSigned(asset.currentValue - asset.valueAtTx)}</div>
                        ) : <div className="text-neutral-700">current {formatPoints(asset.currentValue)}</div>}
                      </>
                    ) : (
                      <>
                        <div className="text-neutral-400">current {formatPoints(asset.currentValue)}</div>
                        <div className="text-[9px] text-neutral-700">fresh neutral KTC-scale pick market</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {transaction.assets.length === 0 ? <p className="text-xs text-neutral-500">No player or pick assets recorded for this transaction.</p> : null}
            </div>
          </article>
        ))}
        {rows.length === 0 ? <p className="text-sm text-neutral-500">No transactions recorded yet. Run a refresh to sync them.</p> : null}
      </div>
    </div>
  );
}
