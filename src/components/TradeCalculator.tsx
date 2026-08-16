"use client";

import { useMemo, useState } from "react";
import type { TradeCalculatorAsset } from "@/lib/tradeFinder";
import { calculateTradeBalance } from "@/lib/tradeValue";

function points(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function verdictLabel(verdict: ReturnType<typeof calculateTradeBalance>["verdict"], primaryName: string, otherName: string) {
  if (verdict === "EVEN") return "Near even after consolidation adjustment";
  if (verdict === "LEAN_GET") return `Slight lean ${primaryName}`;
  if (verdict === "FAVORS_GET") return `Favors ${primaryName}`;
  if (verdict === "HEAVILY_FAVORS_GET") return `Strongly favors ${primaryName}`;
  if (verdict === "LEAN_GIVE") return `Slight lean ${otherName}`;
  if (verdict === "FAVORS_GIVE") return `Favors ${otherName}`;
  return `Strongly favors ${otherName}`;
}

function SideBuilder({
  title,
  assets,
  selectedIds,
  onAdd,
  onRemove,
}: {
  title: string;
  assets: TradeCalculatorAsset[];
  selectedIds: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const selected = selectedIds.map((id) => assets.find((asset) => asset.id === id)).filter(Boolean) as TradeCalculatorAsset[];
  const available = assets.filter((asset) => !selectedIds.includes(asset.id));

  return (
    <div className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{title}</div>
      <div className="flex gap-2">
        <select
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) onAdd(event.target.value);
            event.target.value = "";
          }}
          className="h-9 min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-200 outline-none focus:border-emerald-700"
        >
          <option value="">Add player or pick…</option>
          {available.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.position} · {asset.name} · {points(asset.value)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 space-y-1.5">
        {selected.map((asset) => (
          <div key={asset.id} className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-neutral-100">{asset.name}</div>
              <div className="mt-0.5 truncate text-[9px] text-neutral-600">
                {asset.position}{asset.nflTeam ? ` · ${asset.nflTeam}` : ""} · KTC {points(asset.value)}
                {asset.consensusValue !== null ? ` · fresh consensus ${points(asset.consensusValue)}` : ""}
              </div>
            </div>
            <button type="button" onClick={() => onRemove(asset.id)} className="rounded px-2 py-1 text-[10px] text-neutral-600 hover:bg-neutral-800 hover:text-red-300">Remove</button>
          </div>
        ))}
        {!selected.length ? <div className="rounded-md border border-dashed border-neutral-800 px-3 py-6 text-center text-xs text-neutral-700">No assets selected.</div> : null}
      </div>
    </div>
  );
}

export default function TradeCalculator({
  assets,
  managers,
  primaryManagerId,
  primaryManagerName,
  ktcStale,
  pickMarketAvailable,
}: {
  assets: TradeCalculatorAsset[];
  managers: { id: string; name: string }[];
  primaryManagerId: string;
  primaryManagerName: string;
  ktcStale: boolean;
  pickMarketAvailable: boolean;
}) {
  const otherManagers = managers.filter((manager) => manager.id !== primaryManagerId);
  const [otherManagerId, setOtherManagerId] = useState(otherManagers[0]?.id ?? "");
  const [giveIds, setGiveIds] = useState<string[]>([]);
  const [getIds, setGetIds] = useState<string[]>([]);

  const primaryAssets = useMemo(() => assets.filter((asset) => asset.managerId === primaryManagerId), [assets, primaryManagerId]);
  const otherAssets = useMemo(() => assets.filter((asset) => asset.managerId === otherManagerId), [assets, otherManagerId]);
  const otherName = managers.find((manager) => manager.id === otherManagerId)?.name ?? "Other team";

  const give = giveIds.map((id) => primaryAssets.find((asset) => asset.id === id)).filter(Boolean) as TradeCalculatorAsset[];
  const get = getIds.map((id) => otherAssets.find((asset) => asset.id === id)).filter(Boolean) as TradeCalculatorAsset[];
  const balance = calculateTradeBalance(give, get);
  const canEvaluate = give.length > 0 && get.length > 0;
  const edgeClass = balance.adjustedEdge > 0 ? "text-emerald-300" : balance.adjustedEdge < 0 ? "text-red-300" : "text-neutral-300";

  return (
    <div className="min-w-0 space-y-4">
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Manual Trade Calculator</h2>
            <p className="mt-1 max-w-3xl text-[11px] leading-4 text-neutral-500">
              Uses current KTC anchor values plus a transparent consolidation adjustment, so several lesser pieces do not count as perfectly additive against one stronger asset. This is a dashboard model, not KeepTradeCut's proprietary calculator formula.
            </p>
          </div>
          <div className="shrink-0 text-[10px] text-neutral-600">12-team SF · .5 PPR · no TEP</div>
        </div>

        {ktcStale ? <div className="mt-3 rounded-md border border-amber-900/70 bg-amber-950/20 px-3 py-2 text-[10px] leading-4 text-amber-300">KTC is stale. The calculator is using last known-good KTC values and should not be treated as a live-market quote.</div> : null}
        {!pickMarketAvailable ? <div className="mt-3 rounded-md border border-amber-900/70 bg-amber-950/20 px-3 py-2 text-[10px] leading-4 text-amber-300">The current pick market could not be verified, so draft picks are omitted rather than assigned invented values.</div> : null}

        <div className="mt-4 max-w-sm">
          <label className="text-[9px] font-medium uppercase tracking-wide text-neutral-600">Other team</label>
          <select
            value={otherManagerId}
            onChange={(event) => {
              setOtherManagerId(event.target.value);
              setGetIds([]);
            }}
            className="mt-1 h-9 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200 outline-none focus:border-emerald-700"
          >
            {otherManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
          </select>
        </div>
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <SideBuilder
          title={`${primaryManagerName} gives`}
          assets={primaryAssets}
          selectedIds={giveIds}
          onAdd={(id) => setGiveIds((ids) => [...ids, id])}
          onRemove={(id) => setGiveIds((ids) => ids.filter((value) => value !== id))}
        />
        <SideBuilder
          title={`${otherName} gives`}
          assets={otherAssets}
          selectedIds={getIds}
          onAdd={(id) => setGetIds((ids) => [...ids, id])}
          onRemove={(id) => setGetIds((ids) => ids.filter((value) => value !== id))}
        />
      </div>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
        {!canEvaluate ? (
          <div className="py-6 text-center text-xs text-neutral-600">Add at least one asset to both sides to evaluate the trade.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md bg-neutral-950 p-2.5">
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">Orlando raw KTC</div>
                <div className="mt-1 text-base font-semibold tabular-nums text-neutral-100">{points(balance.give.rawValue)}</div>
              </div>
              <div className="rounded-md bg-neutral-950 p-2.5">
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">Orlando adjusted</div>
                <div className="mt-1 text-base font-semibold tabular-nums text-neutral-100">{points(balance.give.adjustedValue)}</div>
                <div className="text-[9px] text-neutral-700">−{points(balance.give.consolidationAdjustment)} package adjustment</div>
              </div>
              <div className="rounded-md bg-neutral-950 p-2.5">
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">{otherName} raw KTC</div>
                <div className="mt-1 text-base font-semibold tabular-nums text-neutral-100">{points(balance.get.rawValue)}</div>
              </div>
              <div className="rounded-md bg-neutral-950 p-2.5">
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">{otherName} adjusted</div>
                <div className="mt-1 text-base font-semibold tabular-nums text-neutral-100">{points(balance.get.adjustedValue)}</div>
                <div className="text-[9px] text-neutral-700">−{points(balance.get.consolidationAdjustment)} package adjustment</div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">Adjusted verdict</div>
                <div className={`mt-1 text-sm font-semibold ${edgeClass}`}>{verdictLabel(balance.verdict, primaryManagerName, otherName)}</div>
                <div className="mt-1 text-[10px] text-neutral-600">Fairness {balance.fairnessPercent.toFixed(1)}% · Orlando adjusted edge {balance.adjustedEdge > 0 ? "+" : ""}{points(balance.adjustedEdge)}</div>
              </div>
              <button type="button" onClick={() => { setGiveIds([]); setGetIds([]); }} className="rounded-md border border-neutral-700 px-3 py-2 text-xs text-neutral-400 hover:bg-neutral-800">Clear trade</button>
            </div>

            <p className="mt-3 text-[10px] leading-4 text-neutral-600">
              Raw KTC is shown for audit. The adjusted result discounts secondary pieces as packages get larger; picks retain more secondary-piece value because they are more liquid. It is a market-value gut check, not an acceptance probability and not a substitute for the other manager's roster preferences.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
