export const TEAM_OUTLOOK_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export type TeamWindow = "CONTENDER" | "MIDDLE" | "REBUILDER";
export type PositionStatus = "NEED" | "SURPLUS" | "BALANCED" | "UNKNOWN";

export interface PositionOutlookInput {
  position: (typeof TEAM_OUTLOOK_POSITIONS)[number];
  activePlayers: number;
  targetDepth: number;
  starterCapitalRank: number | null;
  teamCount: number;
  window: TeamWindow;
}

export interface PositionOutlook {
  status: PositionStatus;
  priority: string;
  explanation: string;
}

/**
 * Describe roster shape using two explicit checks: start-eligible depth and
 * relative starter-market capital. The thresholds are intentionally simple
 * and are always shown with their evidence on the Team Outlook page.
 */
export function assessPositionOutlook(
  input: PositionOutlookInput,
): PositionOutlook {
  const weakRank = input.starterCapitalRank !== null && input.starterCapitalRank > Math.ceil(input.teamCount * (2 / 3));
  const topRank = input.starterCapitalRank !== null && input.starterCapitalRank <= Math.ceil(input.teamCount / 3);
  const depthShort = input.activePlayers < input.targetDepth;
  const depthSurplus = input.activePlayers >= input.targetDepth + 1;

  if (depthShort || weakRank) {
    const priority =
      input.window === "REBUILDER" &&
      (input.position === "QB" || input.position === "WR")
        ? "Core need"
        : input.window === "CONTENDER"
          ? "Win-now need"
          : "Roster need";
    const reasons = [
      depthShort
        ? `${input.activePlayers} start-eligible vs ${input.targetDepth} depth target`
        : null,
      weakRank
        ? `starter-market capital ranks ${input.starterCapitalRank}/${input.teamCount}`
        : null,
      input.starterCapitalRank === null
        ? "fresh starter-market values are incomplete"
        : null,
    ].filter(Boolean);
    return { status: "NEED", priority, explanation: reasons.join("; ") };
  }

  if (input.starterCapitalRank === null) {
    return {
      status: "UNKNOWN",
      priority: "Market data incomplete",
      explanation: "Depth meets the target, but there are not enough fresh starter values to rank this group against the league.",
    };
  }

  if (topRank && depthSurplus) {
    const priority =
      input.window === "REBUILDER" &&
      (input.position === "RB" || input.position === "TE")
        ? "Review for trade value"
        : "Surplus depth";
    return {
      status: "SURPLUS",
      priority,
      explanation: `starter-market capital ranks ${input.starterCapitalRank}/${input.teamCount} with ${input.activePlayers} start-eligible players`,
    };
  }

  return {
    status: "BALANCED",
    priority: "No clear gap",
    explanation: `starter-market capital ranks ${input.starterCapitalRank}/${input.teamCount}; ${input.activePlayers} start-eligible players`,
  };
}

export function strategySummary(window: TeamWindow): string {
  if (window === "CONTENDER") {
    return "Compete now: strengthen the weakest starting group and consider consolidating extra depth into a lineup upgrade.";
  }
  if (window === "REBUILDER") {
    return "Build long-term value: protect young QB/WR pieces, prioritize future picks, and review excess RB/TE depth for trade value.";
  }
  return "Keep flexibility: address thin or low-ranked groups while avoiding an all-in move before the roster separates from the middle.";
}
