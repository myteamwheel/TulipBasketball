import {
  calculateTradeBalance,
  type TradeBalance,
  type TradeValueAssetInput,
} from "@/lib/tradeValue";

/**
 * A transaction grade is deliberately computed from recorded market values,
 * rather than stored as a mutable database field. The historical grade stays
 * tied to a verified, pre-trade observation whenever one is available. The
 * current grade naturally changes after each successful market refresh.
 */
export type TradeGradeAsset = {
  id: string;
  label: string;
  assetType: "player" | "pick";
  atTradeValue: number | null;
  currentValue: number | null;
};

export type TradeGradeLetter = "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "D";

export type TradeGradePhase = {
  status: "READY" | "INCOMPLETE";
  grade: TradeGradeLetter | null;
  result: "WON" | "EVEN" | "LOST" | null;
  balance: TradeBalance | null;
  valuedAssets: number;
  totalAssets: number;
  missingAssets: string[];
  reason: string | null;
};

export type TradeSideGradeInput = {
  gave: TradeGradeAsset[];
  got: TradeGradeAsset[];
  /** FAAB has no KTC market price. Do not score a partial trade as complete. */
  hasUnpricedAssets?: boolean;
};

export const TRADE_SNAPSHOT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type TradeSnapshotTiming = "AT_OR_BEFORE" | "NEXT_DAY_APPROXIMATION";

export type TradeSnapshotSelection<T> = {
  snapshot: T;
  timing: TradeSnapshotTiming;
};

/**
 * Select a stable historical valuation for a transaction. Prefer the latest
 * verified snapshot at or before the trade, within one day. Only when that is
 * absent can the first verified snapshot after the trade stand in, and callers
 * must surface that it is an approximation. Later refreshes can never replace
 * an already-selected pre-trade value.
 */
export function selectTradeSnapshot<T extends { observedAt: Date }>(
  snapshots: readonly T[],
  tradeAt: Date,
  isVerified: (snapshot: T) => boolean = () => true,
  windowMs = TRADE_SNAPSHOT_WINDOW_MS,
): TradeSnapshotSelection<T> | null {
  const tradeTime = tradeAt.getTime();
  let latestAtOrBefore: T | null = null;
  let firstAfter: T | null = null;

  for (const snapshot of snapshots) {
    if (!isVerified(snapshot)) continue;
    const observedAt = snapshot.observedAt.getTime();
    if (!Number.isFinite(observedAt)) continue;

    if (observedAt <= tradeTime && tradeTime - observedAt <= windowMs) {
      if (
        !latestAtOrBefore ||
        observedAt > latestAtOrBefore.observedAt.getTime()
      ) {
        latestAtOrBefore = snapshot;
      }
      continue;
    }

    if (observedAt > tradeTime && observedAt - tradeTime <= windowMs) {
      if (!firstAfter || observedAt < firstAfter.observedAt.getTime()) {
        firstAfter = snapshot;
      }
    }
  }

  if (latestAtOrBefore) {
    return { snapshot: latestAtOrBefore, timing: "AT_OR_BEFORE" };
  }
  return firstAfter
    ? { snapshot: firstAfter, timing: "NEXT_DAY_APPROXIMATION" }
    : null;
}

function isUsableValue(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function gradeFromEdge(edgePercent: number): {
  grade: TradeGradeLetter;
  result: "WON" | "EVEN" | "LOST";
} {
  const absolute = Math.abs(edgePercent);
  if (absolute <= 3) return { grade: "B", result: "EVEN" };
  if (absolute <= 8)
    return edgePercent > 0
      ? { grade: "B+", result: "WON" }
      : { grade: "B-", result: "LOST" };
  if (absolute <= 15)
    return edgePercent > 0
      ? { grade: "A-", result: "WON" }
      : { grade: "C+", result: "LOST" };
  if (absolute <= 25)
    return edgePercent > 0
      ? { grade: "A", result: "WON" }
      : { grade: "C", result: "LOST" };
  return edgePercent > 0
    ? { grade: "A+", result: "WON" }
    : { grade: "D", result: "LOST" };
}

function calculatePhase(
  side: TradeSideGradeInput,
  key: "atTradeValue" | "currentValue",
): TradeGradePhase {
  const assets = [...side.gave, ...side.got];
  const missingAssets = assets
    .filter((asset) => !isUsableValue(asset[key]))
    .map((asset) => asset.label);

  if (!side.gave.length || !side.got.length) {
    return {
      status: "INCOMPLETE",
      grade: null,
      result: null,
      balance: null,
      valuedAssets: assets.filter((asset) => isUsableValue(asset[key])).length,
      totalAssets: assets.length,
      missingAssets,
      reason: "The Sleeper ledger does not include a complete give-and-get side for this team.",
    };
  }
  if (side.hasUnpricedAssets) {
    return {
      status: "INCOMPLETE",
      grade: null,
      result: null,
      balance: null,
      valuedAssets: assets.filter((asset) => isUsableValue(asset[key])).length,
      totalAssets: assets.length,
      missingAssets,
      reason: "FAAB or another unpriced asset was included, so a complete market grade would be misleading.",
    };
  }
  if (missingAssets.length) {
    return {
      status: "INCOMPLETE",
      grade: null,
      result: null,
      balance: null,
      valuedAssets: assets.length - missingAssets.length,
      totalAssets: assets.length,
      missingAssets,
      reason:
        key === "atTradeValue"
          ? "No verified KTC or pick-market snapshot was recorded close enough to this trade for every asset."
          : "One or more assets do not have a fresh current market value.",
    };
  }

  const values = (items: TradeGradeAsset[]): TradeValueAssetInput[] =>
    items.map((asset) => ({
      value: asset[key]!,
      assetType: asset.assetType,
      name: asset.label,
    }));
  const balance = calculateTradeBalance(values(side.gave), values(side.got));
  const outcome = gradeFromEdge(balance.edgePercent);
  return {
    status: "READY",
    grade: outcome.grade,
    result: outcome.result,
    balance,
    valuedAssets: assets.length,
    totalAssets: assets.length,
    missingAssets: [],
    reason: null,
  };
}

/**
 * Grade one manager's side of a trade at the historical transaction snapshot
 * and at the newest fresh market snapshot. A grade is withheld rather than
 * estimating an absent player, pick, or FAAB value.
 */
export function calculateTradeSideGrades(side: TradeSideGradeInput): {
  atTrade: TradeGradePhase;
  current: TradeGradePhase;
} {
  return {
    atTrade: calculatePhase(side, "atTradeValue"),
    current: calculatePhase(side, "currentValue"),
  };
}

export function tradeGradeTone(phase: TradeGradePhase): "positive" | "neutral" | "negative" | "warning" {
  if (phase.status === "INCOMPLETE") return "warning";
  if (phase.result === "WON") return "positive";
  if (phase.result === "LOST") return "negative";
  return "neutral";
}
