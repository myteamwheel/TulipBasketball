import { prisma } from "@/lib/prisma";
import { ORLANDO_BASELINE_DATE } from "@/lib/config";

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
  sparkline: { value: number; observedAt: string }[];
}

const STALE_MS = 48 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// A time-window label is only valid if a real observation exists close to that
// target date. We never substitute June data for a missing August 7-day point.
const SEVEN_DAY_TOLERANCE_MS = 48 * 60 * 60 * 1000;
const THIRTY_DAY_TOLERANCE_MS = 72 * 60 * 60 * 1000;

export interface Obs {
  value: number;
  observedAt: Date;
  validationStatus: string;
  validationNote: string | null;
}

export async function getObservationSeries(playerIds: string[]): Promise<Map<string, Obs[]>> {
  if (playerIds.length === 0) return new Map();
  const observations = await prisma.ktcObservation.findMany({
    where: { playerId: { in: playerIds }, validationStatus: { not: "REJECTED" } },
    orderBy: { observedAt: "asc" },
    select: { playerId: true, value: true, observedAt: true, validationStatus: true, validationNote: true },
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
): Obs | null {
  const valid = series.filter((o) => o.validationStatus === "VALID");
  if (direction === "before") {
    let result: Obs | null = null;
    for (const o of valid) {
      if (o.observedAt.getTime() <= target.getTime()) result = o;
      else break;
    }
    return result;
  }
  for (const o of valid) {
    if (o.observedAt.getTime() >= target.getTime()) return o;
  }
  return null;
}

function change(current: number, from: Obs): ChangeStat {
  const points = current - from.value;
  const percent = from.value !== 0 ? (points / from.value) * 100 : 0;
  return { points, percent, fromValue: from.value, fromObservedAt: from.observedAt.toISOString() };
}

function closestAtOrBefore(valid: Obs[], target: Date): Obs | null {
  let result: Obs | null = null;
  for (const o of valid) {
    if (o.observedAt.getTime() <= target.getTime()) result = o;
    else break;
  }
  return result;
}

function closestAtOrBeforeWithin(valid: Obs[], target: Date, toleranceMs: number): Obs | null {
  const result = closestAtOrBefore(valid, target);
  if (!result) return null;
  const gap = target.getTime() - result.observedAt.getTime();
  if (gap < 0 || gap > toleranceMs) return null;
  return result;
}

function computeForPlayer(now: Date, observations: Obs[]): PlayerMarketData {
  const sorted = [...observations].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const valid = sorted.filter((o) => o.validationStatus === "VALID");
  const latestOverall = sorted[sorted.length - 1] ?? null;
  const latestValid = valid[valid.length - 1] ?? null;

  const pendingReview = !!latestOverall && latestOverall.validationStatus === "FLAGGED" && latestOverall !== latestValid;

  const currentValue = latestValid?.value ?? null;
  const currentObservedAt = latestValid?.observedAt.toISOString() ?? null;
  const dataAgeMs = latestValid ? now.getTime() - latestValid.observedAt.getTime() : null;
  const isStale = dataAgeMs !== null && dataAgeMs > STALE_MS;

  const previousValid = valid.length >= 2 ? valid[valid.length - 2] : null;
  const changeSinceLastRefresh = latestValid && previousValid ? change(latestValid.value, previousValid) : null;

  // Anchor windows to the latest actual observation, not wall-clock time. This
  // keeps a temporarily stale market from silently shifting the comparison date.
  const anchor = latestValid?.observedAt ?? now;
  const sevenDaysAgo = new Date(anchor.getTime() - 7 * DAY_MS);
  const thirtyDaysAgo = new Date(anchor.getTime() - 30 * DAY_MS);
  const priorValid = latestValid ? valid.slice(0, -1) : [];
  const from7d = latestValid ? closestAtOrBeforeWithin(priorValid, sevenDaysAgo, SEVEN_DAY_TOLERANCE_MS) : null;
  const from30d = latestValid ? closestAtOrBeforeWithin(priorValid, thirtyDaysAgo, THIRTY_DAY_TOLERANCE_MS) : null;
  const change7d = latestValid && from7d ? change(latestValid.value, from7d) : null;
  const change30d = latestValid && from30d ? change(latestValid.value, from30d) : null;

  const baselineDate = new Date(ORLANDO_BASELINE_DATE);
  const baselineObs = valid.find((o) => o.observedAt.getTime() === baselineDate.getTime());
  const changeSinceBaseline = latestValid && baselineObs ? change(latestValid.value, baselineObs) : null;

  let high: Obs | null = null;
  let low: Obs | null = null;
  for (const o of valid) {
    if (!high || o.value > high.value) high = o;
    if (!low || o.value < low.value) low = o;
  }

  const distanceFromHigh =
    latestValid && high
      ? {
          points: latestValid.value - high.value,
          percent: high.value !== 0 ? ((latestValid.value - high.value) / high.value) * 100 : 0,
        }
      : null;
  const distanceFromLow =
    latestValid && low
      ? {
          points: latestValid.value - low.value,
          percent: low.value !== 0 ? ((latestValid.value - low.value) / low.value) * 100 : 0,
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
    high: high ? { value: high.value, observedAt: high.observedAt.toISOString() } : null,
    low: low ? { value: low.value, observedAt: low.observedAt.toISOString() } : null,
    distanceFromHigh,
    distanceFromLow,
    observationCount: valid.length,
    sparkline: valid.slice(-30).map((o) => ({ value: o.value, observedAt: o.observedAt.toISOString() })),
  };
}

export async function computeMarketDataForPlayers(
  playerIds: string[],
): Promise<Map<string, PlayerMarketData>> {
  if (playerIds.length === 0) return new Map();
  const now = new Date();
  const observations = await prisma.ktcObservation.findMany({
    where: { playerId: { in: playerIds }, validationStatus: { not: "REJECTED" } },
    orderBy: { observedAt: "asc" },
    select: { playerId: true, value: true, observedAt: true, validationStatus: true, validationNote: true },
  });

  const byPlayer = new Map<string, Obs[]>();
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

export async function computeMarketDataForPlayer(playerId: string): Promise<PlayerMarketData> {
  const map = await computeMarketDataForPlayers([playerId]);
  return map.get(playerId)!;
}
