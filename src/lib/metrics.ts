import { prisma } from "@/lib/prisma";
import { MARKET_SOURCE_MAX_AGE_MS, ORLANDO_BASELINE_DATE } from "@/lib/config";

export interface ChangeStat {
  points: number;
  percent: number;
  fromValue: number;
  fromObservedAt: string;
}
export interface PlayerMarketData {
  playerId: string;
  currentValue: number | null;
  currentObservedAt: string | null;
  dataAgeMs: number | null;
  isStale: boolean;
  pendingReview: boolean;
  pendingReviewValue: number | null;
  pendingReviewNote: string | null;
  changeSinceLastRefresh: ChangeStat | null;
  change7d: ChangeStat | null;
  change30d: ChangeStat | null;
  changeSinceBaseline: ChangeStat | null;
  high: { value: number; observedAt: string } | null;
  low: { value: number; observedAt: string } | null;
  distanceFromHigh: { points: number; percent: number } | null;
  distanceFromLow: { points: number; percent: number } | null;
  observationCount: number;
  rawObservationCount: number;
  sparkline: { value: number; observedAt: string }[];
}
const STALE_MS = MARKET_SOURCE_MAX_AGE_MS,
  DAY_MS = 86400000,
  SEVEN_DAY_TOLERANCE_MS = 48 * 3600000,
  THIRTY_DAY_TOLERANCE_MS = 72 * 3600000,
  HISTORICAL_TX_TOLERANCE_MS = 7 * DAY_MS,
  RANGE_MIN_SPAN_MS = 14 * DAY_MS;
export interface Obs {
  value: number;
  observedAt: Date;
  validationStatus: string;
  validationNote: string | null;
}
export async function getObservationSeries(
  playerIds: string[],
): Promise<Map<string, Obs[]>> {
  if (!playerIds.length) return new Map();
  const observations = await prisma.ktcObservation.findMany({
    where: { playerId: { in: playerIds }, validationStatus: "VALID" },
    orderBy: { observedAt: "asc" },
    select: {
      playerId: true,
      value: true,
      observedAt: true,
      validationStatus: true,
      validationNote: true,
    },
  });
  const byPlayer = new Map<string, Obs[]>();
  for (const o of observations) {
    const list = byPlayer.get(o.playerId) ?? [];
    list.push(o);
    byPlayer.set(o.playerId, list);
  }
  return byPlayer;
}
export function closestObservation(
  series: Obs[],
  target: Date,
  direction: "before" | "after",
  maxDistanceMs = HISTORICAL_TX_TOLERANCE_MS,
): Obs | null {
  const valid = series.filter((o) => o.validationStatus === "VALID");
  let result: Obs | null = null;
  if (direction === "before") {
    for (const o of valid) {
      if (o.observedAt.getTime() <= target.getTime()) result = o;
      else break;
    }
  } else
    result =
      valid.find((o) => o.observedAt.getTime() >= target.getTime()) ?? null;
  if (!result) return null;
  return Math.abs(result.observedAt.getTime() - target.getTime()) <=
    maxDistanceMs
    ? result
    : null;
}
export function nearestObservation(
  series: Obs[],
  target: Date,
  maxDistanceMs = HISTORICAL_TX_TOLERANCE_MS,
): Obs | null {
  let best: Obs | null = null,
    bestDistance = Infinity;
  for (const o of series) {
    if (o.validationStatus !== "VALID") continue;
    const d = Math.abs(o.observedAt.getTime() - target.getTime());
    if (d <= maxDistanceMs && d < bestDistance) {
      best = o;
      bestDistance = d;
    }
  }
  return best;
}
function change(current: number, from: Obs): ChangeStat {
  const points = current - from.value;
  return {
    points,
    percent: from.value !== 0 ? (points / from.value) * 100 : 0,
    fromValue: from.value,
    fromObservedAt: from.observedAt.toISOString(),
  };
}
function closestAtOrBefore(valid: Obs[], target: Date): Obs | null {
  let result: Obs | null = null;
  for (const o of valid) {
    if (o.observedAt.getTime() <= target.getTime()) result = o;
    else break;
  }
  return result;
}
function closestAtOrBeforeWithin(
  valid: Obs[],
  target: Date,
  toleranceMs: number,
): Obs | null {
  const result = closestAtOrBefore(valid, target);
  if (!result) return null;
  const gap = target.getTime() - result.observedAt.getTime();
  return gap >= 0 && gap <= toleranceMs ? result : null;
}
/** Consecutive identical fetches are freshness heartbeats, not new price states. */
function priceStates(valid: Obs[]): Obs[] {
  const out: Obs[] = [];
  for (const o of valid) {
    const prior = out[out.length - 1];
    if (!prior || prior.value !== o.value) out.push(o);
  }
  return out;
}
function hasDecisionGradeRange(states: Obs[]): boolean {
  return (
    states.length >= 3 &&
    states[states.length - 1].observedAt.getTime() -
      states[0].observedAt.getTime() >=
      RANGE_MIN_SPAN_MS
  );
}
function computeForPlayer(now: Date, observations: Obs[]): PlayerMarketData {
  const sorted = [...observations].sort(
      (a, b) => a.observedAt.getTime() - b.observedAt.getTime(),
    ),
    valid = sorted.filter((o) => o.validationStatus === "VALID"),
    states = priceStates(valid),
    latestOverall = sorted.at(-1) ?? null,
    latestValid = valid.at(-1) ?? null,
    latestState = states.at(-1) ?? null;
  const pendingReview =
      !!latestOverall &&
      latestOverall.validationStatus === "FLAGGED" &&
      latestOverall !== latestValid,
    currentValue = latestValid?.value ?? null,
    currentObservedAt = latestValid?.observedAt.toISOString() ?? null,
    dataAgeMs = latestValid
      ? now.getTime() - latestValid.observedAt.getTime()
      : null,
    isStale = dataAgeMs === null || dataAgeMs > STALE_MS;
  const previousState = states.length >= 2 ? states[states.length - 2] : null,
    changeSinceLastRefresh =
      latestState && previousState
        ? change(latestState.value, previousState)
        : null,
    anchor = latestValid?.observedAt ?? now,
    priorValid = latestValid ? valid.slice(0, -1) : [],
    from7d = latestValid
      ? closestAtOrBeforeWithin(
          priorValid,
          new Date(anchor.getTime() - 7 * DAY_MS),
          SEVEN_DAY_TOLERANCE_MS,
        )
      : null,
    from30d = latestValid
      ? closestAtOrBeforeWithin(
          priorValid,
          new Date(anchor.getTime() - 30 * DAY_MS),
          THIRTY_DAY_TOLERANCE_MS,
        )
      : null,
    change7d = latestValid && from7d ? change(latestValid.value, from7d) : null,
    change30d =
      latestValid && from30d ? change(latestValid.value, from30d) : null;
  const baselineDate = new Date(ORLANDO_BASELINE_DATE),
    baselineObs = valid.find(
      (o) => o.observedAt.getTime() === baselineDate.getTime(),
    ),
    changeSinceBaseline =
      latestValid && baselineObs
        ? change(latestValid.value, baselineObs)
        : null;
  let high: Obs | null = null,
    low: Obs | null = null;
  if (hasDecisionGradeRange(states))
    for (const o of states) {
      if (!high || o.value > high.value) high = o;
      if (!low || o.value < low.value) low = o;
    }
  const distanceFromHigh =
      latestValid && high
        ? {
            points: latestValid.value - high.value,
            percent:
              high.value !== 0
                ? ((latestValid.value - high.value) / high.value) * 100
                : 0,
          }
        : null,
    distanceFromLow =
      latestValid && low
        ? {
            points: latestValid.value - low.value,
            percent:
              low.value !== 0
                ? ((latestValid.value - low.value) / low.value) * 100
                : 0,
          }
        : null;
  return {
    playerId: "",
    currentValue,
    currentObservedAt,
    dataAgeMs,
    isStale,
    pendingReview,
    pendingReviewValue: pendingReview ? latestOverall!.value : null,
    pendingReviewNote: pendingReview ? latestOverall!.validationNote : null,
    changeSinceLastRefresh,
    change7d,
    change30d,
    changeSinceBaseline,
    high: high
      ? { value: high.value, observedAt: high.observedAt.toISOString() }
      : null,
    low: low
      ? { value: low.value, observedAt: low.observedAt.toISOString() }
      : null,
    distanceFromHigh,
    distanceFromLow,
    observationCount: states.length,
    rawObservationCount: valid.length,
    sparkline: states
      .slice(-30)
      .map((o) => ({ value: o.value, observedAt: o.observedAt.toISOString() })),
  };
}
export async function computeMarketDataForPlayers(
  playerIds: string[],
): Promise<Map<string, PlayerMarketData>> {
  if (!playerIds.length) return new Map();
  const now = new Date(),
    observations = await prisma.ktcObservation.findMany({
      where: {
        playerId: { in: playerIds },
        validationStatus: { not: "REJECTED" },
      },
      orderBy: { observedAt: "asc" },
      select: {
        playerId: true,
        value: true,
        observedAt: true,
        validationStatus: true,
        validationNote: true,
      },
    }),
    byPlayer = new Map<string, Obs[]>();
  for (const o of observations) {
    const list = byPlayer.get(o.playerId) ?? [];
    list.push(o);
    byPlayer.set(o.playerId, list);
  }
  const result = new Map<string, PlayerMarketData>();
  for (const playerId of playerIds) {
    const data = computeForPlayer(now, byPlayer.get(playerId) ?? []);
    data.playerId = playerId;
    result.set(playerId, data);
  }
  return result;
}
export async function computeMarketDataForPlayer(
  playerId: string,
): Promise<PlayerMarketData> {
  return (await computeMarketDataForPlayers([playerId])).get(playerId)!;
}
