import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getObservationSeries, closestObservation } from "@/lib/metrics";
import { fetchCurrentDraftPickMarketValues } from "@/lib/marketSources";
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
    fetchCurrentDraftPickMarketValues().catch(() => []),
  ]);

  const managerByRosterId = new Map(managers.map((m) => [m.sleeperRosterId, m]));
  const playerBySleeperId = new Map(players.map((p) => [p.sleeperId, p]));
  const series = await getObservationSeries(players.map((p) => p.id));

  function managerName(rosterId: number) {
    const m = managerByRosterId.get(rosterId);
    return m?.teamName ?? m?.displayName ?? `Roster ${rosterId}`;
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
    const obs = series.get(player.id) ?? [];
    const atTx = closestObservation(obs, txDate, "before") ?? closestObservation(obs, txDate, "after");
    const latest = obs.filter((o) => o.validationStatus === "VALID").slice(-1)[0] ?? null;
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
    const matching = pickMarket.filter((p) => p.season === String(season) && p.round === Number(round));
    const generic = matching.find((p) => p.slot === null);
    if (generic) return { value: generic.value, label: generic.label };
    if (!matching.length) return { value: null, label: null };
    return {
      value: Math.round(matching.reduce((sum, p) => sum + p.value, 0) / matching.length),
      label: `${season} R${round} neutral current value`,
    };
  }

  const rows = transactions.map((t) => {
    const adds = t.adds ? (JSON.parse(t.adds) as Record<string, number>) : {};
    const drops = t.drops ? (JSON.parse(t.drops) as Record<string, number>) : {};
    const draftPicks = t.draftPicks ? (JSON.parse(t.draftPicks) as TradedPick[]) : [];
    const playerAdds = Object.entries(adds).map(([pid, rid]) => playerAsset(pid, rid, t.sleeperCreatedAt, "add"));
    const playerDrops = Object.entries(drops).map(([pid, rid]) => playerAsset(pid, rid, t.sleeperCreatedAt, "drop"));
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

    const tradeSides = [...new Set(t.rosterIdsInvolved ? (JSON.parse(t.rosterIdsInvolved) as number[]) : [])]
      .map((rosterId) => {
        const acquiredPlayers = playerAdds.filter((a) => a.rosterId === rosterId);
        const acquiredPicks = pickAssets.filter((a) => a.rosterId === rosterId);
        const acquired = [...acquiredPlayers, ...acquiredPicks];
        const currentKnown = acquired.filter((a) => a.currentValue !== null);
        const currentTotal = currentKnown.reduce((sum, a) => sum + (a.currentValue ?? 0), 0);
        return {
          rosterId,
          name: managerName(rosterId),
          currentTotal,
          covered: currentKnown.length,
          totalAssets: acquired.length,
          complete: acquired.length > 0 && currentKnown.length === acquired.length,
        };
      })
      .filter((side) => side.totalAssets > 0);

    const tradeCoverageComplete = tradeSides.length >= 2 && tradeSides.every((side) => side.complete);
    const sortedSides = tradeCoverageComplete ? [...tradeSides].sort((a, b) => b.currentTotal - a.currentTotal) : [];
    const currentWinner = t.type === "trade" && sortedSides.length >= 2 ? sortedSides[0] : null;
    const runnerUp = currentWinner ? sortedSides[1] : null;

    const rosterMoveAssets = [...playerAdds, ...playerDrops];
    const moveCoverageComplete = rosterMoveAssets.length > 0 && rosterMoveAssets.every((a) => a.valueAtTx !== null);
    const addAtTx = moveCoverageComplete ? playerAdds.reduce((sum, a) => sum + (a.valueAtTx ?? 0), 0) : 0;
    const dropAtTx = moveCoverageComplete ? playerDrops.reduce((sum, a) => sum + (a.valueAtTx ?? 0), 0) : 0;
    const rosterMoveNet = t.type !== "trade" && moveCoverageComplete ? addAtTx - dropAtTx : null;

    return {
      ...t,
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
          Current trade value includes players and resolvable draft picks. Historical player value uses the nearest stored KTC observation. A winner or grade is withheld when required asset coverage is incomplete.
        </p>
      </div>

      <div className="space-y-3">
        {rows.map((t) => (
          <article key={t.id} className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-3 text-[10px] text-neutral-600">
              <span className="rounded bg-neutral-800 px-2 py-1 font-medium text-neutral-300">{TYPE_LABEL[t.type] ?? t.type}</span>
              <span className="shrink-0 text-right">{formatDateTimeEastern(t.sleeperCreatedAt.toISOString())}</span>
            </div>

            {t.type === "trade" && t.tradeSides.length >= 2 ? (
              <div className="mb-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Current trade value · picks included</span>
                  {t.tradeCoverageComplete && t.currentWinner && t.runnerUp ? (
                    <span className="text-[10px] text-emerald-300">Complete coverage · edge {formatSigned(t.currentWinner.currentTotal - t.runnerUp.currentTotal)}</span>
                  ) : (
                    <span className="text-[10px] text-amber-300">Incomplete coverage · no winner declared</span>
                  )}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {t.tradeSides.map((side) => (
                    <div key={side.rosterId} className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-neutral-900 px-3 py-2">
                      <span className="min-w-0 truncate text-xs text-neutral-300">{side.name}</span>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold tabular-nums text-neutral-100">{formatPoints(side.currentTotal)}</div>
                        <div className={`text-[9px] ${side.complete ? "text-neutral-600" : "text-amber-500"}`}>{side.covered}/{side.totalAssets} valued</div>
                      </div>
                    </div>
                  ))}
                </div>
                {t.tradeCoverageComplete && t.currentWinner ? (
                  <p className="mt-2 text-[10px] leading-4 text-neutral-500">Current-value leader: <span className="font-medium text-emerald-300">{t.currentWinner.name}</span>. This is a current market comparison, not a claim about who made the better decision at the transaction date.</p>
                ) : (
                  <p className="mt-2 text-[10px] leading-4 text-neutral-500">At least one acquired asset lacks a current value, so side totals are shown only as partial information. Missing value is not treated as zero.</p>
                )}
              </div>
            ) : null}

            {t.type !== "trade" ? (
              t.rosterMoveNet !== null ? (
                <div className="mb-3 flex min-w-0 items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs">
                  <span className="min-w-0 text-neutral-500">Move value at nearest stored KTC snapshot</span>
                  <span className={`shrink-0 ${trendColorClass(t.rosterMoveNet)}`}><strong>{t.rosterMoveGrade}</strong> · {formatSigned(t.rosterMoveNet)}</span>
                </div>
              ) : t.assets.length ? (
                <div className="mb-3 rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[10px] leading-4 text-amber-300">No move grade: at least one added/dropped player has no usable KTC observation near the transaction date.</div>
              ) : null
            ) : null}

            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              {t.assets.map((a, i) => (
                <div key={i} className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-3 rounded-md bg-neutral-950 px-3 py-2">
                  <div className="min-w-0">
                    <div className="min-w-0 truncate text-xs">
                      <span className={a.kind === "add" ? "text-emerald-400" : "text-red-400"}>{a.kind === "add" ? "+ " : "− "}</span>
                      {a.playerId ? <Link href={`/players/${a.playerId}`} className="text-neutral-100 hover:text-emerald-300">{a.label}</Link> : <span className="text-neutral-100">{a.label}</span>}
                    </div>
                    <div className="mt-0.5 truncate text-[9px] text-neutral-600">{a.managerName}{a.assetType === "pick" && "previousManagerName" in a ? ` · from ${a.previousManagerName}` : ""}</div>
                  </div>
                  <div className="shrink-0 text-right text-[10px]">
                    {a.assetType === "player" ? (
                      <>
                        <div className="text-neutral-500">at move {formatPoints(a.valueAtTx)}{a.valueAtTxApprox ? <span className="text-neutral-700"> · nearest</span> : null}</div>
                        {a.currentValue !== null && a.valueAtTx !== null ? <div className={trendColorClass(a.currentValue - a.valueAtTx)}>now {formatPoints(a.currentValue)} · {formatSigned(a.currentValue - a.valueAtTx)}</div> : <div className="text-neutral-700">current {formatPoints(a.currentValue)}</div>}
                      </>
                    ) : (
                      <>
                        <div className="text-neutral-400">current {formatPoints(a.currentValue)}</div>
                        <div className="text-[9px] text-neutral-700">neutral KTC-scale pick market</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {t.assets.length === 0 ? <p className="text-xs text-neutral-500">No player or pick assets recorded for this transaction.</p> : null}
            </div>
          </article>
        ))}
        {rows.length === 0 ? <p className="text-sm text-neutral-500">No transactions recorded yet. Run a refresh to sync them.</p> : null}
      </div>
    </div>
  );
}
