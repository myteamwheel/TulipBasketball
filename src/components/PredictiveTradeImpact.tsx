"use client";

import { useState } from "react";
import { projectOptimalWeeklyPoints } from "@/lib/lineupProjection";
import {
  runLeagueSimulation,
  type SimulationContext,
} from "@/lib/simulationCore";

export interface PredictiveTradeAsset {
  id: string;
  assetType: "player" | "pick";
  managerId: string;
  managerName: string;
  name: string;
  position: string;
  marketValue: number;
  modelValue: number;
  forecast1y: number;
  projectedPpg: number;
  slot: string;
}

interface Props {
  assets: PredictiveTradeAsset[];
  context: SimulationContext;
  primaryManagerId: string;
  primaryManagerName: string;
  baselinePlayoff: number;
  baselineTitle: number;
  evidenceWeight: number;
}

const points = (value: number) => Math.round(value).toLocaleString("en-US");
const signed = (value: number, digits = 0) =>
  `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

function Side({
  title,
  assets,
  selected,
  setSelected,
}: {
  title: string;
  assets: PredictiveTradeAsset[];
  selected: string[];
  setSelected: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const chosen = selected
    .map((id) => assets.find((asset) => asset.id === id))
    .filter(Boolean) as PredictiveTradeAsset[];
  const available = assets
    .filter(
      (asset) =>
        !selected.includes(asset.id) &&
        `${asset.name} ${asset.position}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .slice(0, 12);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </div>
      <input
        aria-label={`Search assets for ${title}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search player or pick…"
        className="mt-2 h-9 w-full rounded-md border border-neutral-800 bg-neutral-900 px-2.5 text-xs text-neutral-200 outline-none focus:border-emerald-800"
      />
      <div className="mt-2 max-h-40 space-y-1 overflow-auto">
        {available.map((asset) => (
          <button
            key={asset.id}
            onClick={() => {
              setSelected([...selected, asset.id]);
              setQuery("");
            }}
            className="flex w-full items-center justify-between rounded-md bg-neutral-900 px-2.5 py-2 text-left"
          >
            <span className="truncate text-[11px] text-neutral-200">
              {asset.position} · {asset.name}
            </span>
            <span className="text-[9px] text-neutral-600">
              {points(asset.marketValue)}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-1">
        {chosen.map((asset) => (
          <div
            key={asset.id}
            className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-2"
          >
            <div>
              <div className="text-xs text-neutral-100">{asset.name}</div>
              <div className="text-[9px] text-neutral-600">
                {asset.position} · model {points(asset.modelValue)}
              </div>
            </div>
            <button
              onClick={() =>
                setSelected(selected.filter((id) => id !== asset.id))
              }
              className="text-[9px] text-neutral-600"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function lineupPpg(assets: PredictiveTradeAsset[]) {
  return projectOptimalWeeklyPoints(
    assets
      .filter((asset) => asset.assetType === "player")
      .map((asset) => ({
        id: asset.id,
        position: asset.position,
        projectedPpg: asset.projectedPpg,
        slot: asset.slot,
      })),
  );
}

export default function PredictiveTradeImpact({
  assets,
  context,
  primaryManagerId,
  primaryManagerName,
  baselinePlayoff,
  baselineTitle,
  evidenceWeight,
}: Props) {
  const managers = [
    ...new Map(
      assets
        .filter((asset) => asset.managerId !== primaryManagerId)
        .map((asset) => [asset.managerId, asset.managerName]),
    ).entries(),
  ];
  const [other, setOther] = useState(managers[0]?.[0] ?? "");
  const [giveIds, setGiveIds] = useState<string[]>([]);
  const [getIds, setGetIds] = useState<string[]>([]);

  const primaryAssets = assets.filter(
    (asset) => asset.managerId === primaryManagerId,
  );
  const otherAssets = assets.filter((asset) => asset.managerId === other);
  const give = giveIds
    .map((id) => primaryAssets.find((asset) => asset.id === id))
    .filter(Boolean) as PredictiveTradeAsset[];
  const get = getIds
    .map((id) => otherAssets.find((asset) => asset.id === id))
    .filter(Boolean) as PredictiveTradeAsset[];

  const beforePlayers = primaryAssets.filter(
    (asset) => asset.assetType === "player",
  );
  const afterPlayers = [
    ...beforePlayers.filter((asset) => !giveIds.includes(asset.id)),
    ...get
      .filter((asset) => asset.assetType === "player")
      .map((asset) => ({
        ...asset,
        managerId: primaryManagerId,
        slot: "BENCH",
      })),
  ];
  const otherBeforePlayers = otherAssets.filter(
    (asset) => asset.assetType === "player",
  );
  const otherAfterPlayers = [
    ...otherBeforePlayers.filter((asset) => !getIds.includes(asset.id)),
    ...give
      .filter((asset) => asset.assetType === "player")
      .map((asset) => ({ ...asset, managerId: other, slot: "BENCH" })),
  ];

  const beforePpg = lineupPpg(beforePlayers);
  const afterPpg = lineupPpg(afterPlayers);
  const otherBeforePpg = lineupPpg(otherBeforePlayers);
  const otherAfterPpg = lineupPpg(otherAfterPlayers);
  const marketDelta =
    get.reduce((sum, asset) => sum + asset.marketValue, 0) -
    give.reduce((sum, asset) => sum + asset.marketValue, 0);
  const modelDelta =
    get.reduce((sum, asset) => sum + asset.modelValue, 0) -
    give.reduce((sum, asset) => sum + asset.modelValue, 0);
  const forecastDelta =
    get.reduce((sum, asset) => sum + asset.forecast1y, 0) -
    give.reduce((sum, asset) => sum + asset.forecast1y, 0);

  const scenario = (() => {
    if (!give.length || !get.length || !other) return null;
    const rows = runLeagueSimulation(context, 1200, {
      [primaryManagerId]: { mean: afterPpg, sd: Math.max(8, afterPpg * 0.17) },
      [other]: { mean: otherAfterPpg, sd: Math.max(8, otherAfterPpg * 0.17) },
    });
    const row = rows.find((result) => result.teamId === primaryManagerId);
    if (!row) return null;

    // The league baseline shrinks low-evidence probabilities toward neutral priors.
    // Apply the identical evidence weight to trade scenarios so the delta compares like-for-like.
    const teamCount = context.teams.length;
    const neutralPlayoff = teamCount ? context.playoffTeams / teamCount : 0;
    const neutralTitle = teamCount ? 1 / teamCount : 0;
    return {
      ...row,
      playoffProbability:
        neutralPlayoff +
        (row.playoffProbability - neutralPlayoff) * evidenceWeight,
      championshipProbability:
        neutralTitle +
        (row.championshipProbability - neutralTitle) * evidenceWeight,
    };
  })();

  const otherName = managers.find(([id]) => id === other)?.[1] ?? "Other team";
  const lowEvidence = evidenceWeight < 0.5;

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <h2 className="text-sm font-semibold text-neutral-100">
          Trade Impact Simulator
        </h2>
        <p className="mt-1 text-[10px] leading-4 text-neutral-500">
          This answers a different question than value balance: what does the
          trade do to Orlando&apos;s modeled lineup, fair-value portfolio and
          simulated title path?
        </p>
        <label className="mt-3 block max-w-sm text-[9px] uppercase tracking-wide text-neutral-600">
          Trade partner
          <select
            value={other}
            onChange={(event) => {
              setOther(event.target.value);
              setGetIds([]);
            }}
            className="mt-1 h-9 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 text-xs text-neutral-200"
          >
            {managers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Side
          title={`${primaryManagerName} gives`}
          assets={primaryAssets}
          selected={giveIds}
          setSelected={setGiveIds}
        />
        <Side
          title={`${otherName} gives`}
          assets={otherAssets}
          selected={getIds}
          setSelected={setGetIds}
        />
      </div>

      {give.length && get.length ? (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-md bg-neutral-950 p-2.5">
              <div className="text-[9px] uppercase text-neutral-600">
                Weekly lineup
              </div>
              <div
                className={`mt-1 text-base font-semibold ${afterPpg >= beforePpg ? "text-emerald-300" : "text-red-300"}`}
              >
                {signed(afterPpg - beforePpg, 1)} pts
              </div>
              <div className="text-[9px] text-neutral-600">
                {beforePpg.toFixed(1)} → {afterPpg.toFixed(1)}
              </div>
            </div>
            <div className="rounded-md bg-neutral-950 p-2.5">
              <div className="text-[9px] uppercase text-neutral-600">
                Model value
              </div>
              <div
                className={`mt-1 text-base font-semibold ${modelDelta >= 0 ? "text-emerald-300" : "text-red-300"}`}
              >
                {modelDelta >= 0 ? "+" : ""}
                {points(modelDelta)}
              </div>
              <div className="text-[9px] text-neutral-600">
                evidence-gated fair value
              </div>
            </div>
            <div className="rounded-md bg-neutral-950 p-2.5">
              <div className="text-[9px] uppercase text-neutral-600">
                1-year value
              </div>
              <div
                className={`mt-1 text-base font-semibold ${forecastDelta >= 0 ? "text-emerald-300" : "text-red-300"}`}
              >
                {forecastDelta >= 0 ? "+" : ""}
                {points(forecastDelta)}
              </div>
              <div className="text-[9px] text-neutral-600">forecast means</div>
            </div>
            <div className="rounded-md bg-neutral-950 p-2.5">
              <div className="text-[9px] uppercase text-neutral-600">
                Market value
              </div>
              <div
                className={`mt-1 text-base font-semibold ${marketDelta >= 0 ? "text-emerald-300" : "text-red-300"}`}
              >
                {marketDelta >= 0 ? "+" : ""}
                {points(marketDelta)}
              </div>
              <div className="text-[9px] text-neutral-600">
                current market inventory
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/60 px-2.5 py-2 text-[9px] text-neutral-600">
            Trade-partner lineup is also updated in the league simulation:{" "}
            {otherName} {otherBeforePpg.toFixed(1)} → {otherAfterPpg.toFixed(1)}{" "}
            projected points/week.
          </div>

          {scenario ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">
                  Playoff probability
                </div>
                <div className="mt-1 text-lg font-semibold text-neutral-100">
                  {Math.round(baselinePlayoff * 100)}% →{" "}
                  {Math.round(scenario.playoffProbability * 100)}%
                </div>
                <div
                  className={
                    scenario.playoffProbability >= baselinePlayoff
                      ? "text-[10px] text-emerald-300"
                      : "text-[10px] text-red-300"
                  }
                >
                  {signed(
                    (scenario.playoffProbability - baselinePlayoff) * 100,
                    1,
                  )}{" "}
                  pts
                </div>
              </div>
              <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">
                  Championship probability
                </div>
                <div className="mt-1 text-lg font-semibold text-neutral-100">
                  {Math.round(baselineTitle * 100)}% →{" "}
                  {Math.round(scenario.championshipProbability * 100)}%
                </div>
                <div
                  className={
                    scenario.championshipProbability >= baselineTitle
                      ? "text-[10px] text-emerald-300"
                      : "text-[10px] text-red-300"
                  }
                >
                  {signed(
                    (scenario.championshipProbability - baselineTitle) * 100,
                    1,
                  )}{" "}
                  pts
                </div>
              </div>
            </div>
          ) : null}

          <p className="mt-3 text-[9px] leading-4 text-neutral-600">
            Scenario odds rerun the same league-strength simulation with both
            teams&apos; post-trade optimal projected lineups.{" "}
            {lowEvidence
              ? "Because football evidence is still sparse, both baseline and scenario probabilities are conservatively shrunk toward league-neutral priors. "
              : ""}
            They are model estimates, not guarantees or sportsbook
            probabilities.
          </p>
        </section>
      ) : null}
    </div>
  );
}
