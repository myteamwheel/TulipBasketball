import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { computeMarketDataForPlayer } from "@/lib/metrics";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import { addPlayerNote } from "@/lib/actions";
import KtcHistoryChart from "@/components/KtcHistoryChart";
import PlayerNotes from "@/components/PlayerNotes";
import {
  formatDateEastern,
  formatDateTimeEastern,
  formatPercent,
  formatPoints,
  formatSigned,
  trendColorClass,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PlayerDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) notFound();

  const [observations, ownershipIntervals, notes, market] = await Promise.all([
    prisma.ktcObservation.findMany({
      where: { playerId: id, validationStatus: { not: "REJECTED" } },
      orderBy: { observedAt: "asc" },
    }),
    prisma.ownershipInterval.findMany({
      where: { playerId: id },
      include: { manager: true },
      orderBy: { validFrom: "desc" },
    }),
    prisma.userNote.findMany({ where: { playerId: id }, orderBy: { createdAt: "desc" } }),
    computeMarketDataForPlayer(id),
  ]);

  const signals = await computeSignalsForCurrentRoster();
  const signalEntry = signals.get(id);

  const allTransactions = await prisma.transaction.findMany({
    orderBy: { sleeperCreatedAt: "desc" },
    take: 300,
  });
  const relatedTransactions = allTransactions.filter((t) => {
    const adds = t.adds ? JSON.parse(t.adds) : {};
    const drops = t.drops ? JSON.parse(t.drops) : {};
    return player.sleeperId in adds || player.sleeperId in drops;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">{player.fullName}</h1>
        <p className="text-sm text-neutral-500">
          {player.position}
          {player.nflTeam ? ` · ${player.nflTeam}` : ""}
          {player.status ? ` · ${player.status}` : ""}
        </p>
        {market.isStale && (
          <p className="mt-1 text-xs text-amber-400">
            STALE — no confirmed KTC value in the last 48h. Showing last known-good value.
          </p>
        )}
        {market.pendingReview && (
          <p className="mt-1 text-xs text-amber-400">
            A new value of {formatPoints(market.pendingReviewValue)} is pending review:{" "}
            {market.pendingReviewNote}
          </p>
        )}
      </div>

      {signalEntry && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-2 flex items-center gap-3">
            <span className="rounded border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-sm font-semibold text-neutral-100">
              {signalEntry.result.signal.replace("_", " ")}
            </span>
            <span className="text-sm text-neutral-400">
              Market Score {signalEntry.result.score}/100 · {signalEntry.result.confidence} confidence
            </span>
          </div>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-neutral-400 sm:grid-cols-2">
            {signalEntry.result.reasonCodes.map((r, i) => (
              <li key={i}>
                <span className="text-neutral-300">{r.label}:</span> {r.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Current KTC</p>
          <p className="mt-1 text-3xl font-semibold text-neutral-100">{formatPoints(market.currentValue)}</p>
          <p className="text-[11px] text-neutral-600">as of {formatDateEastern(market.currentObservedAt)}</p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">7-Day</p>
          <p className={`mt-1 text-xl font-semibold ${trendColorClass(market.change7d?.points)}`}>
            {formatSigned(market.change7d?.points)}
          </p>
          <p className="text-[11px] text-neutral-600">{formatPercent(market.change7d?.percent)}</p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">30-Day</p>
          <p className={`mt-1 text-xl font-semibold ${trendColorClass(market.change30d?.points)}`}>
            {formatSigned(market.change30d?.points)}
          </p>
          <p className="text-[11px] text-neutral-600">{formatPercent(market.change30d?.percent)}</p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Since Baseline</p>
          <p className={`mt-1 text-xl font-semibold ${trendColorClass(market.changeSinceBaseline?.points)}`}>
            {market.changeSinceBaseline ? formatSigned(market.changeSinceBaseline.points) : "n/a"}
          </p>
          <p className="text-[11px] text-neutral-600">{formatPercent(market.changeSinceBaseline?.percent)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm">
          <p className="text-neutral-400">
            Tracked high <span className="font-semibold text-neutral-100">{formatPoints(market.high?.value)}</span>{" "}
            <span className="text-neutral-600">({formatDateEastern(market.high?.observedAt)})</span>
          </p>
          <p className="mt-1 text-neutral-400">
            Drawdown from peak{" "}
            <span className={trendColorClass(market.distanceFromHigh?.percent)}>
              {formatPercent(market.distanceFromHigh?.percent)}
            </span>
          </p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm">
          <p className="text-neutral-400">
            Tracked low <span className="font-semibold text-neutral-100">{formatPoints(market.low?.value)}</span>{" "}
            <span className="text-neutral-600">({formatDateEastern(market.low?.observedAt)})</span>
          </p>
          <p className="mt-1 text-neutral-400">
            Above low{" "}
            <span className={trendColorClass(market.distanceFromLow?.percent)}>
              {formatPercent(market.distanceFromLow?.percent)}
            </span>
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-100">Value History</h3>
        <KtcHistoryChart
          points={observations.map((o) => ({
            value: o.value,
            observedAt: o.observedAt.toISOString(),
            validationStatus: o.validationStatus,
          }))}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-100">Observation Log</h3>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-900">
                <tr className="text-neutral-500">
                  <th className="py-1 text-left">Observed</th>
                  <th className="py-1 text-right">Value</th>
                  <th className="py-1 text-right">Source</th>
                  <th className="py-1 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...observations].reverse().map((o) => (
                  <tr key={o.id} className="border-t border-neutral-800/60">
                    <td className="py-1 text-neutral-400">{formatDateTimeEastern(o.observedAt.toISOString())}</td>
                    <td className="py-1 text-right text-neutral-100">{formatPoints(o.value)}</td>
                    <td className="py-1 text-right text-neutral-500">{o.sourceType}</td>
                    <td
                      className={`py-1 text-right ${
                        o.validationStatus === "VALID" ? "text-emerald-500" : "text-amber-500"
                      }`}
                    >
                      {o.validationStatus}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-100">Ownership Timeline</h3>
          <ul className="space-y-1.5 text-xs">
            {ownershipIntervals.map((oi) => (
              <li key={oi.id} className="flex justify-between text-neutral-300">
                <span>{oi.manager.teamName ?? oi.manager.displayName}</span>
                <span className="text-neutral-500">
                  {formatDateEastern(oi.validFrom.toISOString())} –{" "}
                  {oi.validTo ? formatDateEastern(oi.validTo.toISOString()) : "present"}
                </span>
              </li>
            ))}
            {ownershipIntervals.length === 0 && <li className="text-neutral-500">No ownership history recorded.</li>}
          </ul>

          <h3 className="mb-2 mt-4 text-sm font-semibold text-neutral-100">Recent Transactions</h3>
          <ul className="space-y-1 text-xs text-neutral-400">
            {relatedTransactions.slice(0, 10).map((t) => (
              <li key={t.id}>
                {t.type} — {formatDateEastern(t.sleeperCreatedAt.toISOString())}
              </li>
            ))}
            {relatedTransactions.length === 0 && <li className="text-neutral-500">None recorded.</li>}
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-100">Notes</h3>
        <PlayerNotes
          playerId={player.id}
          initialNotes={notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString() }))}
          addNoteAction={addPlayerNote}
        />
      </div>
    </div>
  );
}
