import { getAllCurrentRosterEntries, getPrimaryManager } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations, getLatestSlotMap } from "@/lib/teamMetrics";
import { getCurrentMarketMix } from "@/lib/marketSources";
import { normalizePlayerName } from "@/lib/normalize";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type Position = (typeof POSITIONS)[number];

// These are user strategy constraints, not roster hardcoding. Sleeper still owns
// the live roster/ownership state and a player only appears here if Sleeper says
// he is currently rostered in this league.
const PROTECTED_ORLANDO = new Set(
  [
    "Cam Ward",
    "Quinshon Judkins",
    "Colston Loveland",
    "Luther Burden",
    "Eli Stowers",
    "Jeremiyah Love",
    "Emeka Egbuka",
    "Michael Penix Jr.",
  ].map(normalizePlayerName),
);

const DO_NOT_TARGET = new Set(
  ["Geno Smith", "Kenneth Walker", "Kenneth Walker III", "TreVeyon Henderson"].map(normalizePlayerName),
);

const STRATEGIC_TARGETS = new Set(
  ["Tua Tagovailoa", "Makai Lemon", "Elijah Hampton"].map(normalizePlayerName),
);

const POSITION_PRIORITY: Record<Position, number> = { QB: 34, WR: 27, RB: 25, TE: 5 };

export type TradeFinderAsset = {
  id: string;
  name: string;
  position: string;
  value: number;
  slot: string;
};

export type TradeFinderOffer = {
  give: TradeFinderAsset[];
  get: TradeFinderAsset[];
  giveValue: number;
  getValue: number;
  delta: number;
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
  tradeChipCount: number;
};

type LiveAsset = TradeFinderAsset & {
  managerId: string;
  managerName: string;
  nflTeam: string | null;
  consensusValue: number | null;
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

function needsForManager(
  managerId: string,
  valuations: Awaited<ReturnType<typeof computeAllTeamValuations>>,
): Position[] {
  return POSITIONS.map((position) => ({
    position,
    rank: managerPositionRank(managerId, position, valuations),
  }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 2)
    .map((x) => x.position);
}

function combinations(chips: LiveAsset[]): LiveAsset[][] {
  const pool = chips.slice(0, 18);
  const result: LiveAsset[][] = pool.map((chip) => [chip]);
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) result.push([pool[i], pool[j]]);
  }
  return result;
}

function offerCandidates(target: LiveAsset, chips: LiveAsset[], ownerNeeds: Position[]): TradeFinderOffer[] {
  const targetValue = target.value;
  const packages = combinations(chips)
    .map((give) => {
      const giveValue = give.reduce((sum, x) => sum + x.value, 0);
      const ratio = targetValue > 0 ? giveValue / targetValue : 99;
      const needMatches = [...new Set(give.map((x) => x.position).filter((p) => ownerNeeds.includes(p as Position)))];
      const benchCount = give.filter((x) => x.slot !== "STARTER").length;
      const acceptablePenalty = ratio < 0.72 || ratio > 1.28 ? 2400 : 0;
      const closenessPenalty = Math.abs(giveValue - targetValue);
      const needBonus = needMatches.length * 525;
      const depthBonus = benchCount * 120;
      return {
        give,
        giveValue,
        getValue: targetValue,
        delta: targetValue - giveValue,
        ownerNeedMatch: needMatches,
        rankScore: closenessPenalty + acceptablePenalty - needBonus - depthBonus,
      };
    })
    .sort((a, b) => a.rankScore - b.rankScore);

  const selected: typeof packages = [];
  for (const candidate of packages) {
    if (selected.some((x) => x.give.map((p) => p.id).sort().join(":") === candidate.give.map((p) => p.id).sort().join(":"))) continue;
    if (selected.length === 1 && selected[0].give.length === candidate.give.length) continue;
    selected.push(candidate);
    if (selected.length === 2) break;
  }

  return selected.map(({ give, giveValue, getValue, delta, ownerNeedMatch }) => ({
    give: give.map(({ id, name, position, value, slot }) => ({ id, name, position, value, slot })),
    get: [{ id: target.id, name: target.name, position: target.position, value: target.value, slot: target.slot }],
    giveValue,
    getValue,
    delta,
    ownerNeedMatch,
  }));
}

function confidenceFor(score: number, offers: TradeFinderOffer[]): "HIGH" | "MEDIUM" | "LOW" {
  const best = offers[0];
  if (!best) return "LOW";
  const ratioGap = best.getValue > 0 ? Math.abs(best.giveValue - best.getValue) / best.getValue : 1;
  if (score >= 76 && ratioGap <= 0.12) return "HIGH";
  if (score >= 60 && ratioGap <= 0.23) return "MEDIUM";
  return "LOW";
}

export async function buildTradeFinderData(): Promise<TradeFinderData | null> {
  const primary = await getPrimaryManager();
  if (!primary) return null;

  const entries = await getAllCurrentRosterEntries();
  const playerIds = entries.map((e) => e.playerId);
  const [market, mix, valuations, slotMap] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    getCurrentMarketMix(playerIds),
    computeAllTeamValuations(),
    getLatestSlotMap(),
  ]);

  const assets: LiveAsset[] = entries
    .map((entry) => {
      const m = market.get(entry.playerId)!;
      const mx = mix.get(entry.playerId);
      return {
        id: entry.player.id,
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
    .filter((a) => a.value > 0);

  const orlandoRanks = Object.fromEntries(
    POSITIONS.map((position) => [position, managerPositionRank(primary.id, position, valuations)]),
  ) as Record<Position, number>;

  const orlandoNeeds = [
    { position: "QB", leagueRank: orlandoRanks.QB, note: "Second startable QB / Superflex liquidity" },
    { position: "WR", leagueRank: orlandoRanks.WR, note: "Add a startable pass-catcher without moving the core" },
    { position: "RB", leagueRank: orlandoRanks.RB, note: "Add startable RB value when the price is efficient" },
  ];

  const chips = assets
    .filter((a) => a.managerId === primary.id)
    .filter((a) => !PROTECTED_ORLANDO.has(normalizePlayerName(a.name)))
    .filter((a) => a.value >= 500)
    .sort((a, b) => b.value - a.value);

  const targets = assets
    .filter((a) => a.managerId !== primary.id)
    .filter((a) => ["QB", "WR", "RB"].includes(a.position))
    .filter((a) => a.value >= 1700)
    .filter((a) => !DO_NOT_TARGET.has(normalizePlayerName(a.name)))
    .map((target) => {
      const pos = target.position as Position;
      const ownerNeeds = needsForManager(target.managerId, valuations);
      const ownerSamePosition = assets.filter(
        (a) => a.managerId === target.managerId && a.position === target.position && a.value >= 1800,
      ).length;
      const ownerHasSurplus =
        (pos === "QB" && ownerSamePosition >= 3) ||
        ((pos === "WR" || pos === "RB") && ownerSamePosition >= 4);

      const offers = offerCandidates(target, chips, ownerNeeds);
      const tags: string[] = [];
      let score = POSITION_PRIORITY[pos] ?? 0;

      if (pos === "QB") tags.push("QB2 priority");
      if (pos === "WR") tags.push("WR upgrade");
      if (pos === "RB") tags.push("RB upgrade");

      const rank = orlandoRanks[pos];
      score += Math.max(0, rank - 4) * 3;
      if (rank >= 8) tags.push(`Orlando #${rank} ${pos}`);

      if (target.value >= 2500 && target.value <= 6500) score += 12;
      else if (target.value <= 7600) score += 6;

      if (target.change30d !== null && target.change30d < 0) {
        score += Math.min(10, Math.abs(target.change30d) / 90);
        tags.push("Buy-low window");
      }
      if (target.consensusValue !== null && target.consensusValue > target.value * 1.04) {
        score += 8;
        tags.push("Consensus > KTC");
      }
      if (ownerHasSurplus) {
        score += 9;
        tags.push("Owner depth");
      }
      if (STRATEGIC_TARGETS.has(normalizePlayerName(target.name))) {
        score += 16;
        tags.unshift("Priority target");
      }
      if (offers[0]) {
        const ratioGap = Math.abs(offers[0].giveValue - offers[0].getValue) / offers[0].getValue;
        if (ratioGap <= 0.12) score += 8;
        if (offers[0].ownerNeedMatch.length > 0) {
          score += 6;
          tags.push(`Matches ${target.managerName} need`);
        }
      }

      const fitScore = Math.max(1, Math.min(99, Math.round(score)));
      const confidence = confidenceFor(fitScore, offers);
      const needText = ownerNeeds.join(" / ");
      const movementText =
        target.change30d === null
          ? "30-day history is limited"
          : target.change30d < 0
            ? `KTC is down ${Math.abs(Math.round(target.change30d)).toLocaleString("en-US")} over the tracked 30-day window`
            : `KTC is up ${Math.round(target.change30d).toLocaleString("en-US")} over the tracked 30-day window`;
      const why = `${target.position} addresses Orlando’s current ${target.position === "QB" ? "Superflex/QB2" : target.position} priority; ${target.managerName} grades weakest at ${needText}. ${movementText}.`;

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
    .slice(0, 24);

  return {
    targets,
    orlandoNeeds,
    protectedNames: [
      "Cam Ward",
      "Quinshon Judkins",
      "Colston Loveland",
      "Luther Burden",
      "Eli Stowers",
      "Jeremiyah Love",
      "Emeka Egbuka",
      "Michael Penix Jr.",
    ],
    tradeChipCount: chips.length,
  };
}
