import { parseFaabTransfers } from "@/lib/tradeFaab";

type TradeRecord = {
  rosterIdsInvolved: string;
  adds: string | null;
  draftPicks: string | null;
  waiverBudget: string | null;
};

function array(value: string | null): unknown[] {
  try { const parsed: unknown = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function object(value: string | null): Record<string, unknown> {
  try { const parsed: unknown = JSON.parse(value ?? "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function rosterId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function summarizeRecentTrade(
  trade: TradeRecord,
  teamNames: Map<number, string>,
  playerNames: Record<string, string>,
) {
  const players = Object.entries(object(trade.adds)).flatMap(([playerId, receiver]) => {
    const id = rosterId(receiver);
    return id === null ? [] : [{ receiver: id, label: playerNames[playerId] ?? `Player ${playerId}` }];
  });
  const picks = array(trade.draftPicks).flatMap(row => {
    if (!row || typeof row !== "object") return [];
    const pick = row as Record<string, unknown>;
    const receiver = rosterId(pick.owner_id);
    const season = Number(pick.season), round = Number(pick.round);
    return receiver !== null && Number.isInteger(season) && Number.isInteger(round) && round > 0
      ? [{ receiver, label: `${season} Round ${round} pick` }]
      : [];
  });
  const faab = parseFaabTransfers(trade.waiverBudget).map(row => ({ receiver: row.receiver, label: `$${row.amount} FAAB` }));
  const recipients = [...players, ...picks, ...faab];
  const participants = [...new Set([...array(trade.rosterIdsInvolved).map(rosterId).filter((id): id is number => id !== null), ...recipients.map(row => row.receiver)])];
  const packages = participants.map(id => ({ team: teamNames.get(id) ?? `Team ${id}`, assets: recipients.filter(row => row.receiver === id).map(row => row.label) }));
  return { title: packages.map(row => row.team).join(" ↔ ") || "Recorded trade", packages };
}
