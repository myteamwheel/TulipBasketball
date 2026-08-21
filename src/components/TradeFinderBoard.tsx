"use client";
import Link from "next/link";
import { useState } from "react";
import type { TradeFinderData, TradeFinderOffer } from "@/lib/tradeFinder";
import TradeCalculator from "@/components/TradeCalculator";
const points = (v: number) => Math.round(v).toLocaleString("en-US"),
  signed = (v: number) =>
    `${v > 0 ? "+" : v < 0 ? "" : "±"}${Math.round(v).toLocaleString("en-US")}`;
type AssetView = {
  id: string;
  assetType?: "player" | "pick";
  name: string;
  position: string;
  value: number;
};
function Asset({ asset }: { asset: AssetView }) {
  const body = (
      <>
        <span className="text-[9px] text-neutral-600">{asset.position}</span>
        <span className="truncate text-[11px] font-medium text-neutral-100">
          {asset.name}
        </span>
        <span className="text-[9px] tabular-nums text-neutral-600">
          {points(asset.value)}
        </span>
      </>
    ),
    cls =
      "inline-flex max-w-full items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5";
  return asset.assetType !== "pick" && !asset.id.startsWith("pick:") ? (
    <Link
      href={`/players/${asset.id}`}
      className={`${cls} hover:border-emerald-800`}
    >
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
  );
}
function Offer({ offer }: { offer: TradeFinderOffer }) {
  const edgeClass =
    offer.adjustedEdge > 0
      ? "text-emerald-300"
      : offer.adjustedEdge < 0
        ? "text-red-300"
        : "text-neutral-300";
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="grid gap-3 lg:grid-cols-[1fr_32px_1fr_180px] lg:items-center">
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-wide text-red-300/70">
            Orlando gives
          </div>
          <div className="flex flex-wrap gap-1.5">
            {offer.give.map((a) => (
              <Asset key={a.id} asset={a} />
            ))}
          </div>
        </div>
        <div className="hidden text-center text-neutral-700 lg:block">→</div>
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-wide text-emerald-300/70">
            Orlando gets
          </div>
          <div className="flex flex-wrap gap-1.5">
            {offer.get.map((a) => (
              <Asset key={a.id} asset={a} />
            ))}
          </div>
        </div>
        <div className="rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-right">
          <div className="text-[9px] uppercase tracking-wide text-neutral-600">
            {offer.packageQuality === "STRONG"
              ? "Strong value match"
              : "Workable value match"}
          </div>
          <div className="text-[9px] text-neutral-600">
            Value balance {offer.valueBalance.toFixed(0)}%
          </div>
          <div
            className={`mt-1 text-xs font-semibold tabular-nums ${edgeClass}`}
          >
            Orlando edge {signed(offer.adjustedEdge)}
          </div>
        </div>
      </div>
    </div>
  );
}
export default function TradeFinderBoard({ data }: { data: TradeFinderData }) {
  const [mode, setMode] = useState<"targets" | "shop" | "calculator">(
      "targets",
    ),
    [position, setPosition] = useState("ALL"),
    [owner, setOwner] = useState("ALL"),
    [sort, setSort] = useState<"fit" | "value" | "dip" | "balance">("fit");
  const primaryAssets = data.calculatorAssets
      .filter((a) => a.managerId === data.primaryManagerId)
      .sort((a, b) => b.value - a.value),
    shopAssets = primaryAssets.filter((a) =>
      data.shopEligibleAssetIds.includes(a.id),
    ),
    [shopAsset, setShopAsset] = useState(shopAssets[0]?.id ?? ""),
    visible = data.targets
      .filter(
        (t) =>
          (position === "ALL" || t.position === position) &&
          (owner === "ALL" || t.ownerId === owner),
      )
      .sort((a, b) =>
        sort === "value"
          ? b.value - a.value
          : sort === "dip"
            ? (a.change30dPercent ?? 999) - (b.change30dPercent ?? 999)
            : sort === "balance"
              ? (b.offers[0]?.valueBalance ?? 0) -
                (a.offers[0]?.valueBalance ?? 0)
              : b.fitScore - a.fitScore || b.value - a.value,
      ),
    targetOwners = [
      ...new Map(data.targets.map((t) => [t.ownerId, t.ownerName])).entries(),
    ],
    shopMatches = data.targets
      .flatMap((t) =>
        t.offers
          .filter((o) => o.give.some((a) => a.id === shopAsset))
          .map((o) => ({ target: t, offer: o })),
      )
      .sort((a, b) => b.offer.valueBalance - a.offer.valueBalance),
    partners = [
      ...new Map(
        data.targets.map((t) => [
          t.ownerId,
          {
            id: t.ownerId,
            name: t.ownerName,
            needs: t.ownerNeeds,
            count: 0,
            best: 0,
          },
        ]),
      ).values(),
    ]
      .map((p) => {
        const rows = data.targets.filter((t) => t.ownerId === p.id);
        return {
          ...p,
          count: rows.length,
          best: Math.max(...rows.map((r) => r.fitScore)),
        };
      })
      .sort((a, b) => b.best - a.best || b.count - a.count)
      .slice(0, 6);
  return (
    <div className="min-w-0 space-y-4">
      <div className="inline-flex flex-wrap rounded-lg border border-neutral-800 bg-neutral-900 p-1">
        <button
          aria-pressed={mode === "targets"}
          onClick={() => setMode("targets")}
          className={`rounded-md px-3 py-1.5 text-xs ${mode === "targets" ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}
        >
          Target Finder
        </button>
        <button
          aria-pressed={mode === "shop"}
          onClick={() => setMode("shop")}
          className={`rounded-md px-3 py-1.5 text-xs ${mode === "shop" ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}
        >
          Shop an Asset
        </button>
        <button
          aria-pressed={mode === "calculator"}
          onClick={() => setMode("calculator")}
          className={`rounded-md px-3 py-1.5 text-xs ${mode === "calculator" ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}
        >
          Trade Calculator
        </button>
      </div>
      {mode === "calculator" ? (
        <TradeCalculator
          assets={data.calculatorAssets}
          managers={data.managers}
          primaryManagerId={data.primaryManagerId}
          primaryManagerName={data.primaryManagerName}
          ktcStale={data.ktcStale}
          pickMarketAvailable={data.pickMarketAvailable}
        />
      ) : mode === "shop" ? (
        <section className="space-y-3">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            <h2 className="text-sm font-semibold text-neutral-100">
              Who can realistically return value for this asset?
            </h2>
            <p className="mt-1 text-[10px] leading-4 text-neutral-500">
              Only assets eligible for generated outgoing packages appear here.
              Private owner constraints stay private; the manual calculator
              remains unrestricted.
            </p>
            {shopAssets.length ? (
              <select
                aria-label="Asset to shop"
                value={shopAsset}
                onChange={(e) => setShopAsset(e.target.value)}
                className="mt-3 h-9 w-full max-w-xl rounded-md border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
              >
                {shopAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.assetType === "pick" ? "PICK" : a.position} · {a.name} ·{" "}
                    {points(a.value)}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-3 text-xs text-neutral-500">
                No assets are currently eligible for generated outgoing
                packages.
              </div>
            )}
          </div>
          {shopMatches.map(({ target, offer }, i) => (
            <article
              key={`${target.id}:${i}`}
              className="rounded-xl border border-neutral-800 bg-neutral-900 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <Link
                    href={`/players/${target.id}`}
                    className="text-sm font-semibold text-neutral-100 hover:text-emerald-300"
                  >
                    {target.name}
                  </Link>
                  <div className="text-[10px] text-neutral-600">
                    {target.ownerName} · {target.position} · KTC{" "}
                    {points(target.value)}
                  </div>
                </div>
                <div className="text-[10px] text-neutral-500">
                  {offer.valueBalance.toFixed(0)}% balance
                </div>
              </div>
              <Offer offer={offer} />
            </article>
          ))}
          {shopAsset && !shopMatches.length ? (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-center text-xs text-neutral-500">
              No generated package currently uses this asset. Try another asset
              or build the trade manually.
            </div>
          ) : null}
        </section>
      ) : (
        <>
          {data.ktcStale ? (
            <div className="rounded-lg border border-amber-900 bg-amber-950/20 p-3 text-xs text-amber-300">
              Generated recommendations are paused until current KTC refresh
              succeeds.
            </div>
          ) : null}
          {!data.rankingComplete ? (
            <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-[10px] leading-4 text-amber-300">
              Market-strength ranks are provisional because at least one league
              roster contains a player with no KTC value. Missing value is not
              treated as zero.
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {data.orlandoNeeds.map((n, i) => (
              <div
                key={n.position}
                className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"
              >
                <div className="text-xs font-semibold text-neutral-100">
                  Market weakness #{i + 1}: {n.position}
                </div>
                <div className="mt-1 text-[10px] text-neutral-500">
                  {n.note}
                </div>
              </div>
            ))}
          </div>
          {partners.length ? (
            <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                Trade-partner map
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {partners.map((p) => (
                  <button
                    key={p.id}
                    aria-pressed={owner === p.id}
                    onClick={() => setOwner(p.id)}
                    className="rounded-md bg-neutral-950 p-2.5 text-left hover:bg-neutral-800"
                  >
                    <div className="truncate text-xs font-medium text-neutral-200">
                      {p.name}
                    </div>
                    <div className="mt-1 text-[9px] text-neutral-600">
                      Weakest market groups {p.needs.join(" / ")} · {p.count}{" "}
                      target match{p.count === 1 ? "" : "es"}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-4 text-neutral-500">
            <span className="font-medium text-neutral-300">Offer pool:</span>{" "}
            {data.playerTradeChipCount} eligible Orlando players and{" "}
            {data.pickTradeChipCount} verified owned picks. Generated packages
            can now return multiple opposing assets and use up to three Orlando
            pieces.
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <div className="flex flex-wrap gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
              {["ALL", "QB", "RB", "WR", "TE"].map((f) => (
                <button
                  key={f}
                  aria-pressed={position === f}
                  onClick={() => setPosition(f)}
                  className={`rounded-md px-3 py-1.5 text-[11px] ${position === f ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}
                >
                  {f === "ALL" ? "All positions" : f}
                </button>
              ))}
            </div>
            <select
              aria-label="Filter targets by team"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="h-9 rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-300"
            >
              <option value="ALL">All teams</option>
              {targetOwners.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Sort trade targets"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="h-9 rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-300"
            >
              <option value="fit">Best fit</option>
              <option value="balance">Best package balance</option>
              <option value="dip">Largest valid 30d dip</option>
              <option value="value">Highest KTC</option>
            </select>
          </div>
          <div className="space-y-3">
            {visible.map((t) => (
              <article
                key={t.id}
                className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 sm:p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/players/${t.id}`}
                        className="text-base font-semibold text-neutral-100 hover:text-emerald-300"
                      >
                        {t.name}
                      </Link>
                      <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-400">
                        {t.position}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-neutral-500">
                      Owner {t.ownerName} · KTC {points(t.value)}
                      {t.consensusValue !== null
                        ? ` · trusted ${points(t.consensusValue)}`
                        : ""}
                      {t.change30dPercent !== null
                        ? ` · 30d ${t.change30dPercent >= 0 ? "+" : ""}${t.change30dPercent.toFixed(1)}%`
                        : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] uppercase tracking-wide text-neutral-600">
                      Trade fit
                    </div>
                    <div className="text-sm font-semibold text-neutral-200">
                      {t.fitScore >= 76
                        ? "High"
                        : t.fitScore >= 58
                          ? "Medium"
                          : "Low"}
                    </div>
                    <div className="text-[9px] text-neutral-600">
                      {t.confidence.toLowerCase()} data confidence
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 text-[9px] text-neutral-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
                  <div className="text-[9px] uppercase tracking-wide text-neutral-600">
                    Why it surfaced
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-neutral-400">
                    {t.why}
                  </p>
                </div>
                <div className="mt-3 space-y-2">
                  {t.offers.map((o, i) => (
                    <Offer key={i} offer={o} />
                  ))}
                </div>
              </article>
            ))}
            {!visible.length && !data.ktcStale ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-500">
                No reasonable package matches these filters right now.
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
