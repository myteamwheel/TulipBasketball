export type Quote = { value: number; date: string };
export type Selection = {
  id: string; draft: string; year: number; auction: boolean; start: string; overall: number;
  round: number; teams: number; bid: number | null; playerId: string; name: string; pos: string;
  owner: string | null; manager: string | null; team: string | null; profile: string | null;
  at: Quote | null; two: Quote | null; due: string; now: Quote | null; games: number; points: number; seasons?: {year:number; games:number; points:number}[]; one?: Quote | null; three?: Quote | null;
};
export type Grade = { letter: string; score: number; edge: number; penalty: number };
export type GradedPick = Selection & { entry: Grade | null; outcome: Grade | null; current: Quote | null };
export type Lens = "entry" | "outcome";

export function pickLabel(p: Selection) {
  return p.auction ? `$${p.bid} bid · #${p.overall}` : `${p.round}.${String((p.overall - 1) % p.teams + 1).padStart(2, "0")}`;
}

function makeGrade(raw: number, penalty = 0): Grade {
  const adjusted = Math.max(0, Math.min(100, raw - penalty));
  const score = Math.round(adjusted);
  return { score, edge: (adjusted - 80) / 100, penalty: Math.round(penalty * 10) / 10,
    letter: score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F" };
}

function elapsedSeasons(p: Selection, asOf: string) {
  return Math.max(1, Number(asOf.slice(0, 4)) - p.year + 1);
}

export function gradeDrafts(picks: Selection[], asOf: string): GradedPick[] {
  const drafts = new Map<string, Selection[]>();
  for (const pick of picks) drafts.set(pick.draft, [...(drafts.get(pick.draft) ?? []), pick]);
  const oldest = new Date(Date.parse(asOf.slice(0, 10)) - 2 * 86400000).toISOString().slice(0, 10);
  const fresh = (p: Selection) => p.now && p.now.date >= oldest && p.now.date <= asOf ? p.now : null;

  return [...drafts.values()].flatMap(board => board.map(p => {
    const current = fresh(p);
    const valued = board.filter(x => x.at);
    const draftRank = p.at ? 1 + valued.filter(x => x.at!.value > p.at!.value).length : null;
    const selectedRank = 1 + valued.filter(x => x.overall < p.overall).length;
    // A dated KTC ranking is a proxy for draft-day consensus, not Sleeper ADP.
    const entry = draftRank === null || valued.length < 2 ? null :
      makeGrade(80 + Math.max(-12, Math.min(12, (selectedRank - draftRank) * 1.2)));

    const seasons = p.seasons ?? [];
    const pointsPerGameTarget: Record<string, number> = { QB: 18, RB: 12, WR: 12, TE: 9 };
    const target = pointsPerGameTarget[p.pos] ?? 12;
    // Reward useful seasons over the entire career since selection. A single
    // cameo cannot represent a full productive season.
    const productionTotal = seasons.reduce((sum, season) => {
      const ppg = season.points / season.games;
      return sum + Math.min(1, season.games / 10) * Math.max(0, Math.min(1.2, ppg / target));
    }, 0);
    const opportunity = Math.min(2, Math.max(1, elapsedSeasons(p, asOf)));
    const production = Math.min(100, productionTotal / opportunity * 85);
    const elapsedYears = Math.max(0, (Date.parse(asOf) - Date.parse(p.start)) / (365.25 * 86400000));
    // Compare a player with the price paid at the time, rather than a fixed
    // first-round threshold. Missing historical market data remains ungraded.
    const marketScore = current && p.at
      ? Math.max(0, Math.min(100, 80 + 18 * Math.log2((current.value + 750) / (p.at.value + 750))))
      : null;
    // Recent selections have had little time to play. For older picks, credit
    // all productive seasons and normalize expectations by draft investment.
    const productionWeight = Math.min(0.35, Math.max(0, elapsedYears - 1) * 0.18);
    const roundBaseline = [0, 48, 36, 25, 16][Math.min(p.round, 4)];
    const performance = p.seasons && elapsedYears >= 1 ? Math.max(0, Math.min(100, 70 + (production - roundBaseline) * 0.6)) : null;
    let raw: number | null = marketScore;
    if (marketScore !== null && performance !== null) raw = marketScore * (1 - productionWeight) + performance * productionWeight;
    if (marketScore === null && current && performance !== null && elapsedYears >= 2) raw = performance;
    const alternatives = board.filter(x => x.overall > p.overall && x.overall <= p.overall + 4);
    const penalty = current ? alternatives.reduce((sum, x) => {
      const other = fresh(x);
      if (!other || other.value <= current.value) return sum;
      const distance = x.overall - p.overall;
      const samePosition = x.pos === p.pos ? 1.5 : 1;
      const proximity = distance <= 2 ? 1.25 : 1;
      const roundWeight = [0, 2.4, 1.8, 1.1, 0.6][Math.min(p.round, 4)];
      const gap = Math.min(1, (other.value - current.value) / Math.max(2000, current.value));
      return sum + roundWeight * samePosition * proximity * gap;
    }, 0) : 0;
    return { ...p, entry, current, outcome: raw === null ? null : makeGrade(raw, Math.min(10, penalty)) };
  }));
}

export function rankManagers(picks: GradedPick[], lens: Lens) {
  const groups = new Map<string,{ owner:string; name:string; count:number; graded:number; sum:number; fs:number }>();
  for (const p of picks) {
    if (!p.owner) continue;
    const row = groups.get(p.owner) ?? { owner:p.owner, name:p.manager ?? p.owner, count:0, graded:0, sum:0, fs:0 };
    row.count++;
    const g = p[lens];
    if (g) { row.graded++; row.sum+=g.score; if (g.letter==="F") row.fs++; }
    groups.set(p.owner,row);
  }
  return [...groups.values()].map(row=>({...row,average:row.graded ? row.sum/row.graded : null}))
    .sort((a,b)=>(b.average ?? -1)-(a.average ?? -1) || b.graded-a.graded || a.name.localeCompare(b.name));
}
