export type TradeAssetType = "player" | "pick";

export interface TradeValueAssetInput {
  value: number;
  assetType: TradeAssetType;
  name?: string;
  position?: string;
}

export interface PackageTradeValue {
  rawValue: number;
  adjustedValue: number;
  consolidationAdjustment: number;
  adjustmentPercent: number;
  assetCount: number;
  topAssetValue: number;
}

export interface TradeBalance {
  give: PackageTradeValue;
  get: PackageTradeValue;
  rawEdge: number;
  adjustedEdge: number;
  edgePercent: number;
  fairnessPercent: number;
  verdict: "HEAVILY_FAVORS_GIVE" | "FAVORS_GIVE" | "LEAN_GIVE" | "EVEN" | "LEAN_GET" | "FAVORS_GET" | "HEAVILY_FAVORS_GET";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function secondaryWeight(asset: TradeValueAssetInput, index: number, topValue: number) {
  // Draft picks are more liquid than similarly valued depth players, so they
  // retain more of their raw value when included as secondary pieces.
  let weight = asset.assetType === "pick" ? 0.92 : 0.84;

  // The third/fourth/etc. piece should not make a package scale linearly.
  if (index === 2) weight -= 0.08;
  else if (index >= 3) weight -= 0.14 + Math.min(0.12, (index - 3) * 0.03);

  // Two assets in the same value tier are more fungible than a star plus a dart.
  if (topValue > 0 && asset.value / topValue >= 0.75) weight += 0.04;

  // Low-end throw-ins have limited roster-slot utility in consolidation deals.
  if (asset.value < 1000) weight -= 0.08;
  else if (asset.value < 1750) weight -= 0.03;

  return clamp(weight, 0.58, 0.96);
}

/**
 * KTC-style consolidation adjustment for package comparison.
 *
 * This is intentionally not presented as KeepTradeCut's proprietary formula.
 * KTC publicly explains that its calculator is not simple addition and that its
 * value adjustment considers stud factor, value gaps and the number of lesser
 * pieces. This model implements those same principles transparently so a 2-for-1
 * package cannot be mislabeled as even merely because the raw values sum closely.
 */
export function calculatePackageTradeValue(assets: TradeValueAssetInput[]): PackageTradeValue {
  const clean = assets
    .filter((asset) => Number.isFinite(asset.value) && asset.value > 0)
    .map((asset) => ({ ...asset, value: Math.round(asset.value) }))
    .sort((a, b) => b.value - a.value);

  if (!clean.length) {
    return {
      rawValue: 0,
      adjustedValue: 0,
      consolidationAdjustment: 0,
      adjustmentPercent: 0,
      assetCount: 0,
      topAssetValue: 0,
    };
  }

  const rawValue = clean.reduce((sum, asset) => sum + asset.value, 0);
  const topAssetValue = clean[0].value;
  let adjustedValue = topAssetValue;

  for (let index = 1; index < clean.length; index++) {
    adjustedValue += clean[index].value * secondaryWeight(clean[index], index, topAssetValue);
  }

  adjustedValue = Math.round(adjustedValue);
  const consolidationAdjustment = rawValue - adjustedValue;
  const adjustmentPercent = rawValue > 0 ? (consolidationAdjustment / rawValue) * 100 : 0;

  return {
    rawValue,
    adjustedValue,
    consolidationAdjustment,
    adjustmentPercent,
    assetCount: clean.length,
    topAssetValue,
  };
}

export function calculateTradeBalance(
  giveAssets: TradeValueAssetInput[],
  getAssets: TradeValueAssetInput[],
): TradeBalance {
  const give = calculatePackageTradeValue(giveAssets);
  const get = calculatePackageTradeValue(getAssets);
  const rawEdge = get.rawValue - give.rawValue;
  const adjustedEdge = get.adjustedValue - give.adjustedValue;
  const denominator = Math.max(give.adjustedValue, get.adjustedValue, 1);
  const edgePercent = (adjustedEdge / denominator) * 100;
  const fairnessPercent = Math.min(give.adjustedValue, get.adjustedValue) / denominator * 100;
  const absolute = Math.abs(edgePercent);

  let verdict: TradeBalance["verdict"] = "EVEN";
  if (absolute > 15) verdict = adjustedEdge > 0 ? "HEAVILY_FAVORS_GET" : "HEAVILY_FAVORS_GIVE";
  else if (absolute > 8) verdict = adjustedEdge > 0 ? "FAVORS_GET" : "FAVORS_GIVE";
  else if (absolute > 3) verdict = adjustedEdge > 0 ? "LEAN_GET" : "LEAN_GIVE";

  return { give, get, rawEdge, adjustedEdge, edgePercent, fairnessPercent, verdict };
}
