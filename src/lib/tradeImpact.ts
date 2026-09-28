import {
  getAllCurrentRosterEntries,
  getPrimaryManager,
} from "@/lib/queries";
import { getCachedDynastyBoysSimulation } from "@/lib/leagueSimulation";
import { getDecisionGradePredictiveModels } from "@/lib/predictiveSafety";
import { computeAllTeamValuations, getLatestSlotMap } from "@/lib/teamMetrics";
import { publicTeamName } from "@/lib/publicIdentity";
import { getProjectionDashboardData } from "@/lib/weeklyProjection";
import type { SimulationContext } from "@/lib/simulationCore";

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

export interface TradeImpactData {
  assets: PredictiveTradeAsset[];
  context: SimulationContext;
  primaryManagerId: string;
  primaryManagerName: string;
  baselinePlayoff: number;
  baselineTitle: number;
  evidenceWeight: number;
}

/**
 * Collect the current roster, market, and projection inputs for the interactive
 * trade-impact view. It is kept out of the Prediction Center so that page can
 * stay focused on player research rather than a league-wide trade form.
 */
export async function getTradeImpactData(): Promise<TradeImpactData | null> {
  const [entries, primary, valuations, slotMap, simulation] = await Promise.all([
    getAllCurrentRosterEntries(),
    getPrimaryManager(),
    computeAllTeamValuations(),
    getLatestSlotMap(),
    getCachedDynastyBoysSimulation(),
  ]);
  if (!primary) return null;

  const playerIds = [...new Set(entries.map((entry) => entry.playerId))];
  const [models, projectionData] = await Promise.all([
    getDecisionGradePredictiveModels(playerIds),
    getProjectionDashboardData(),
  ]);
  const weeklyProjectionByPlayer = new Map(
    projectionData.current.map((row) => [
      row.playerId,
      row.projectedFantasyPoints,
    ]),
  );
  const weeklyWithheld = new Set(
    projectionData.unavailable
      .filter((row) => row.status === "EXCLUDED")
      .map((row) => row.playerId),
  );
  const assets: PredictiveTradeAsset[] = [];

  for (const entry of entries) {
    const model = models.get(entry.playerId);
    if (!model) continue;
    assets.push({
      id: entry.playerId,
      assetType: "player",
      managerId: entry.managerId,
      managerName: publicTeamName(entry.manager),
      name: entry.player.fullName,
      position: entry.player.position,
      marketValue: model.currentValue,
      modelValue: model.modelValue,
      forecast1y: model.forecast1y.mean,
      projectedPpg: weeklyWithheld.has(entry.playerId)
        ? 0
        : weeklyProjectionByPlayer.get(entry.playerId) ?? 0,
      slot: slotMap.get(`${entry.managerId}:${entry.playerId}`) ?? "BENCH",
    });
  }
  for (const valuation of valuations) {
    for (const pick of valuation.draftPicks) {
      assets.push({
        id: pick.id,
        assetType: "pick",
        managerId: valuation.managerId,
        managerName: valuation.teamName,
        name: pick.label,
        position: "PICK",
        marketValue: pick.value,
        modelValue: pick.value,
        forecast1y: pick.value,
        projectedPpg: 0,
        slot: "PICK",
      });
    }
  }

  const baseline = simulation.rows.find((row) => row.managerId === primary.id);
  return {
    assets,
    context: simulation.context,
    primaryManagerId: primary.id,
    primaryManagerName: publicTeamName(primary),
    baselinePlayoff: baseline?.playoffProbability ?? 0,
    baselineTitle: baseline?.championshipProbability ?? 0,
    evidenceWeight: simulation.evidenceWeight,
  };
}
