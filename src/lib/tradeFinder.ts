import { getAllCurrentRosterEntries, getAllManagers, getPrimaryManager } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations, getLatestSlotMap } from "@/lib/teamMetrics";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";
import { getLatestMarketSourceStatuses } from "@/lib/marketSources";
import { fetchFreshDraftPickMarketValues } from "@/lib/pickMarket";
import { calculatePackageTradeValue } from "@/lib/tradeValue";
import { getTradedPicks } from "@/lib/sleeper";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type Position = (typeof POSITIONS)[number];

export type TradeFinderAsset = {
  id: string;
  assetType: "player" | "pick";
  name: string;
  position: string;
  value: number;
  slot: string;
};

export type TradeCalculatorAsset = TradeFinderAsset & {
  managerId: string;
  managerName: string;
  nflTeam: string | null;
  consensusValue: number | null;
};

export type TradeFinderOffer = {
  give: TradeFinderAsset[];
  get: TradeFinderAsset[];
  giveRawValue: number;
  getRawValue: number;
  giveAdjustedValue: number;
  getAdjustedValue: number;
  rawEdge: number;
  adjustedEdge: number;
  ownerNeedMatch: string[];
};

export type TradeFinderTarget = {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  ownerName: string;
  ownerId: string;
  value: number;
  consensusValue: number | null;
  change30d: number | null;
  fitScore: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  tags: string[];
  ownerNeeds: string[];
  why: string;
  offers: TradeFinderOffer[];
};

export type TradeFinderData = {
  targets: TradeFinderTarget[];
  orlandoNeeds: { position: string; leagueRank: number; note: string }[];
  protectedNames: string[];
  playerTradeChipCount: number;
  pickTradeChipCount: number;
  primaryManagerId: string;
  primaryManagerName: string;
  managers: { id: string; name: string }[];
  calculatorAssets: TradeCalculatorAsset[];
  ktcStale: boolean;
  ktcObservedAt: string | null;
  pickMarketAvailable: boolean;
};

type LiveAsset = TradeCalculatorAsset & {
  change30d: number | null;
};

function managerPositionRank(
  managerId: string,
  position: Position,
  valuations: Awaited<ReturnType<typeof computeAllTeamValuations>>,
): number {
  const ranked = [...valuations].sort(
    (a, b) => (b.positionalValue[position] ?? 0) - (a.positionalValue[position] ?? 0),
  );
  const index = ranked.findIndex((v) => v.managerId === managerId);
  return index >= 0 ? index + 1 : ranked.length;
}

function rankedPositionNeeds(
  managerId: string,
  valuations: Awaited<ReturnType<typeof computeAllTeamValuations>>,
) {
  return POSITIONS.map((position) => ({
    position,
    rank: managerPositionRank(managerId, position, valuations),
  })).sort((a, b) => b.rank - a.rank || a.position.localeCompare(b.position));
}

function needsForManager(
  managerId: string,
  valuations: Awaited<ReturnType<typeof computeAllTeamValuations>>,
): Position[] {
  return rankedPositionNeeds(managerId, valuations).slice(0, 2).map((x) => x.position);
}

function combinations(chips: LiveAsset[]): LiveAsset[][] {
  // Two-piece packages cover the useful generated-offer space without turning
  // the finder into a pile-of-darts engine. The manual calculator has no such
  // restriction.
  const pool = chips.slice(0, 28);
  const result: LiveAsset[][] = pool.map((chip) => [chip]);
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) result.push([pool[i], pool[j]]);
  }
  return result;
}

function offerCandidates(target: LiveAsset, chips: LiveAsset[], ownerNeeds: Position[]): TradeFinderOffer[] {
  const targetPackage = calculatePackageTradeValue([target]);
  const packages = combinations(chips)
    .map((give) => {
      const givePackage = calculatePackageTradeValue(give);
      const adjustedRatio = targetPackage.adjustedValue > 0
        ? givePackage.adjustedValue / targetPackage.adjustedValue
        : 99;
      const needMatches = [...new Set(give.map((x) => x.position).filter((p) => ownerNeeds.includes(p as Position)))];
      const containsPick = give.some((x) => x.assetType === "pick");
      const extraPieces = Math.max(0, give.length - 1);

      // A raw-sum near tie can still be a bad consolidation offer. Treat a
      // package below 94% of the adjusted target value as a meaningful underpay.
      const rangePenalty = adjustedRatio < 0.94 || adjustedRatio > 1.20 ? 5000 : 0;
      const closenessPenalty = Math.abs(givePackage.adjustedValue - targetPackage.adjustedValue);
      const needBonus = needMatches.length * 425;
      const pickLiquidityBonus = containsPick ? 90 : 0;
      const pilePenalty = extraPieces * 75;

      return {
        give,
        givePackage,
        targetPackage,
        ownerNeedMatch: needMatches,
        rankScore: closenessPenalty + rangePenalty + pilePenalty - needBonus - pickLiquidityBonus,
      };
    })
    .sort((a, b) => a.rankScore - b.rankScore);

  const selected: typeof packages = [];
  for (const candidate of packages) {
    const key = candidate.give.map((p) => p.id).sort().join(":");
    if (selected.some((x) => x.give.map((p) => p.id).sort().join(":") === key)) continue;

    if (selected.length === 1) {
      const firstHasPick = selected[0].give.some((x) => x.assetType === "pick");
      const candidateHasPick = candidate.give.some((x) => x.assetType === "pick");
      // Prefer the second suggestion to have a different structure.
      if (selected[0].give.length === candidate.give.length && firstHasPick === candidateHasPick) continue;
    }

    selected.push(candidate);
    if (selected.length === 2) break;
  }

  return selected.map(({ give, givePackage, targetPackage, ownerNeedMatch }) => ({
    give: give.map(({ id, assetType, name, position, value, slot }) => ({ id, assetType, name, position, value, slot })),
    get: [{ id: target.id, assetType: "player", name: target.name, position: target.position, value: target.value, slot: target.slot }],
    giveRawValue: givePackage.rawValue,
    getRawValue: targetPackage.rawValue,
    giveAdjustedValue: givePackage.adjustedValue,
    getAdjustedValue: targetPackage.adjustedValue,
    rawEdge: targetPackage.rawValue - givePackage.rawValue,
    adjustedEdge: targetPackage.adjustedValue - givePackage.adjustedValue,
    ownerNeedMatch,
  }));
}

function confidenceFor(
  fitScore: number,
  offers: TradeFinderOffer[],
  ktcStale: boolean,
): "HIGH" | "MEDIUM" | "LOW" {
  if (ktcStale) return "LOW";
  const best = offers[0];
  if (!best || best.getAdjustedValue <= 0) return "LOW";
  const gap = Math.abs(best.giveAdjustedValue - best.getAdjustedValue) / best.getAdjustedValue;
  if (fitScore >= 72 && gap <= 0.05) return "HIGH";
  if (fitScore >= 58 && gap <= 0.10) return "MEDIUM";
  return "LOW";
}

function ordinalRound(round: number): string {
  if (round === 1) return "1st";
  if (round === 2) return "2nd";
  if (round === 3) return "3rd";
  return `${round}th`;
}

function neutralPickValue(
  pickMarket: Awaited<ReturnType<typeof fetchFreshDraftPickMarketValues>>,
  season: number,
  round: number,
): number | null {
  const matching = pickMarket.filter((p) => Number(p.season) === season && p.round === round);
  if (!matching.length) return null;
  const generic = matching.find((p) => p.slot === null);
  if (generic) return generic.value;
  return Math.round(matching.reduce((sum, p) => sum + p.value, 0) / matching.length);
}

export async function buildTradeFinderData(): Promise<TradeFinderData | null> {
  const primary = await getPrimaryManager();
  if (!primary) return null;

  const entries = await getAllCurrentRosterEntries();
  const playerIds = entries.map((e) => e.playerId);
  const [market, mix, valuations, slotMap, managers, tradedPicks, pickMarket, league, marketStatuses] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    getFreshCurrentMarketMix(playerIds),
    computeAllTeamValuations(),
    getLatestSlotMap(),
    getAllManagers(),
    getTradedPicks(SLEEPER_LEAGUE_ID).catch(() => []),
    fetchFreshDraftPickMarketValues().catch(() => []),
    prisma.league.findFirst({ where: { sleeperId: SLEEPER_LEAGUE_ID }, select: { settings: true } }),
    getLatestMarketSourceStatuses(),
  ]);

  const assets: LiveAsset[] = entries
    .map((entry) => {
      const m = market.get(entry.playerId)!;
      const mx = mix.get(entry.playerId);
      return {
        id: entry.player.id,
        assetType: "player" as const,
        name: entry.player.fullName,
        position: entry.player.position,
        value: m.currentValue ?? 0,
        slot: slotMap.get(`${entry.managerId}:${entry.playerId}`) ?? "BENCH",
        managerId: entry.managerId,
        managerName: entry.manager.teamName ?? entry.manager.displayName,
        nflTeam: entry.player.nflTeam,
        consensusValue: mx?.consensusValue ?? null,
        change30d: m.change30d?.points ?? null,
      };
    })
    .filter((asset) => asset.value > 0);

  let draftRounds = 4;
  try {
    const settings = league?.settings ? JSON.parse(league.settings) : null;
    const parsed = Number(settings?.settings?.draft_rounds);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 10) draftRounds = parsed;
  } catch {}

  const currentYear = new Date().getUTCFullYear();
  const futureSeasons = [...new Set(
    pickMarket
      .map((p) => Number(p.season))
      .filter((year) => Number.isFinite(year) && year > currentYear),
  )].sort((a, b) => a - b).slice(0, 4);

  const managerByRosterId = new Map(managers.map((m) => [m.sleeperRosterId, m]));
  const allPickAssets: LiveAsset[] = [];
  for (const season of futureSeasons) {
    for (let round = 1; round <= draftRounds; round++) {
      const value = neutralPickValue(pickMarket, season, round);
      if (!value || value < 200) continue;

      for (const origin of managers) {
        const moved = tradedPicks.find(
          (p) => Number(p.season) === season && p.round === round && p.roster_id === origin.sleeperRosterId,
        );
        const currentOwnerRosterId = moved?.owner_id ?? origin.sleeperRosterId;
        const currentOwner = managerByRosterId.get(currentOwnerRosterId);
        if (!currentOwner) continue;
        const originName = origin.teamName ?? origin.displayName;

        allPickAssets.push({
          id: `pick:${season}:${round}:${origin.sleeperRosterId}`,
          assetType: "pick",
          name: `${season} ${ordinalRound(round)} · ${originName} original`,
          position: "PICK",
          value,
          slot: "PICK",
          managerId: currentOwner.id,
          managerName: currentOwner.teamName ?? currentOwner.displayName,
          nflTeam: null,
          consensusValue: null,
          change30d: null,
        });
      }
    }
  }

  // Generated offers automatically avoid the seven most valuable current
  // Orlando players. This is derived live rather than hardcoding an old list of
  // personal targets/untouchables. The manual calculator can still use anyone.
  const primaryPlayers = assets
    .filter((asset) => asset.managerId === primary.id)
    .sort((a, b) => b.value - a.value);
  const autoProtected = primaryPlayers.slice(0, Math.min(7, primaryPlayers.length));
  const autoProtectedIds = new Set(autoProtected.map((asset) => asset.id));

  const playerChips = primaryPlayers
    .filter((asset) => !autoProtectedIds.has(asset.id))
    .filter((asset) => asset.value >= 500);
  const pickChips = allPickAssets.filter((asset) => asset.managerId === primary.id);
  const chips = [...playerChips, ...pickChips].sort((a, b) => b.value - a.value);

  const orlandoNeedRanks = rankedPositionNeeds(primary.id, valuations);
  const orlandoNeeds = orlandoNeedRanks.slice(0, 3).map(({ position, rank }) => ({
    position,
    leagueRank: rank,
    note: `#${rank} of ${valuations.length} in current ${position} player value`,
  }));

  const ktcStale = marketStatuses.KTC.stale;
  const targets = assets
    .filter((asset) => asset.managerId !== primary.id)
    .filter((asset) => POSITIONS.includes(asset.position as Position))
    .filter((asset) => asset.value >= 1700)
    .map((target) => {
      const position = target.position as Position;
      const ownerNeeds = needsForManager(target.managerId, valuations);
      const ownerSamePosition = assets.filter(
        (asset) => asset.managerId === target.managerId && asset.position === position && asset.value >= 1800,
      ).length;
      const ownerHasSurplus =
        (position === "QB" && ownerSamePosition >= 3) ||
        ((position === "RB" || position === "WR") && ownerSamePosition >= 4) ||
        (position === "TE" && ownerSamePosition >= 3);

      const offers = offerCandidates(target, chips, ownerNeeds);
      const tags: string[] = [];
      const rank = managerPositionRank(primary.id, position, valuations);
      let score = 35;

      // Live Orlando need replaces hard-coded player target lists.
      score += Math.max(0, Math.min(24, (rank - 3) * 3));
      if (rank >= 8) tags.push(`Orlando #${rank} ${position}`);
      else if (rank <= 3) tags.push(`Orlando already strong at ${position}`);

      if (target.value >= 2500 && target.value <= 6500) score += 8;
      else if (target.value <= 7600) score += 4;

      if (target.change30d !== null && target.change30d < 0) {
        score += Math.min(5, Math.abs(target.change30d) / 180);
        tags.push("Valid 30d dip");
      }
      if (target.consensusValue !== null && target.consensusValue > target.value * 1.04) {
        score += 5;
        tags.push("Fresh consensus > KTC");
      }
      if (ownerHasSurplus) {
        score += 8;
        tags.push(`Owner has ${position} depth`);
      }

      const best = offers[0];
      if (best && best.getAdjustedValue > 0) {
        const gap = Math.abs(best.giveAdjustedValue - best.getAdjustedValue) / best.getAdjustedValue;
        if (gap <= 0.05) score += 10;
        else if (gap <= 0.10) score += 6;
        if (best.ownerNeedMatch.length > 0) {
          score += 7;
          tags.push(`Package helps ${target.managerName}`);
        }
        if (offers.some((offer) => offer.give.some((asset) => asset.assetType === "pick"))) {
          tags.push("Pick structure available");
        }
      }

      if (ktcStale) score -= 8;
      const fitScore = Math.max(1, Math.min(92, Math.round(score)));
      const confidence = confidenceFor(fitScore, offers, ktcStale);
      const needText = ownerNeeds.join(" / ");
      const movementText = target.change30d === null
        ? "No valid 30-day comparison is available"
        : target.change30d < 0
          ? `KTC is down ${Math.abs(Math.round(target.change30d)).toLocaleString("en-US")} over a valid 30-day window`
          : `KTC is up ${Math.round(target.change30d).toLocaleString("en-US")} over a valid 30-day window`;
      const why = `${position} ranks #${rank} for Orlando by current league positional value. ${target.managerName}'s two weakest positional value groups are ${needText}. ${movementText}.`;

      return {
        id: target.id,
        name: target.name,
        position: target.position,
        nflTeam: target.nflTeam,
        ownerName: target.managerName,
        ownerId: target.managerId,
        value: target.value,
        consensusValue: target.consensusValue,
        change30d: target.change30d,
        fitScore,
        confidence,
        tags: [...new Set(tags)].slice(0, 5),
        ownerNeeds,
        why,
        offers,
      } satisfies TradeFinderTarget;
    })
    .filter((target) => target.offers.length > 0)
    .sort((a, b) => b.fitScore - a.fitScore || b.value - a.value)
    .slice(0, 30);

  const calculatorAssets: TradeCalculatorAsset[] = [...assets, ...allPickAssets]
    .map(({ change30d: _change30d, ...asset }) => asset)
    .sort((a, b) => a.managerName.localeCompare(b.managerName) || b.value - a.value);

  return {
    targets,
    orlandoNeeds,
    protectedNames: autoProtected.map((asset) => asset.name),
    playerTradeChipCount: playerChips.length,
    pickTradeChipCount: pickChips.length,
    primaryManagerId: primary.id,
    primaryManagerName: primary.teamName ?? primary.displayName,
    managers: managers.map((manager) => ({ id: manager.id, name: manager.teamName ?? manager.displayName })),
    calculatorAssets,
    ktcStale,
    ktcObservedAt: marketStatuses.KTC.observedAt,
    pickMarketAvailable: pickMarket.length > 0,
  };
}
