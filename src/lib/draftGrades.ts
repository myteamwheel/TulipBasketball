export type Quote = { value: number; date: string };
export type Selection = {
  id: string; draft: string; year: number; auction: boolean; start: string; overall: number;
  round: number; teams: number; bid: number | null; playerId: string; name: string; pos: string;
  owner: string | null; manager: string | null; team: string | null; profile: string | null;
  at: Quote | null; two: Quote | null; due: string; now: Quote | null; games: number; points: number; seasons?: {year:number; games:number; points:number}[]; one?: Quote | null; three?: Quote | null;
};
export type Grade = { letter: string; score: number; edge: number; penalty: number; breakdown?: { benchmark: number; marketScore: number; productionAdjustment: number; historyQuotes: number; rawScore: number }; };
export type GradedPick = Selection & { entry: Grade | null; outcome: Grade | null; current: Quote | null };
export type Lens = "entry" | "outcome";

export function pickLabel(p: Selection) {
  return p.auction ? `$${p.bid} bid · #${p.overall}` : `${p.round}.${String((p.overall - 1) % p.teams + 1).padStart(2, "0")}`;
}

function makeGrade(raw: number, penalty = 0): Grade {
  const adjusted = Math.max(0, Math.min(100, raw - penalty));
  const score = Math.round(adjusted);
  return { score, edge: (raw - penalty - 80) / 100, penalty: Math.round(penalty * 10) / 10,
    letter: score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F" };
}

/** Draft-day KTC value at the equivalent rank among the players actually
 * selected in this draft. It is a class-relative estimate, not pick ADP. */
function slotBenchmark(pick: Selection, board: Selection[]): number | null {
  const values = board.flatMap(p => p.at ? [p.at.value] : []).sort((a, b) => b - a);
  if (values.length < 8 || values.length / board.length < 0.75) return null;
  const rank = Math.round((pick.overall - 1) * (values.length - 1) / Math.max(1, board.length - 1));
  return values[rank];
}

export function gradeDrafts(picks: Selection[], asOf: string): GradedPick[] {
  const drafts = new Map<string, Selection[]>();
  for (const pick of picks) drafts.set(pick.draft, [...(drafts.get(pick.draft) ?? []), pick]);
  const oldest = new Date(Date.parse(asOf.slice(0, 10)) - 2 * 86400000).toISOString().slice(0, 10);
  const fresh = (p: Selection) => p.now && p.now.date >= oldest && p.now.date <= asOf ? p.now : null;

  return [...drafts.values()].flatMap(board => board.map(p => {
    const current = fresh(p);
    const benchmark = slotBenchmark(p, board);
    const entry = p.at && benchmark !== null
      ? makeGrade(80 + 16 * Math.log2((p.at.value + 750) / (benchmark + 750))) : null;
    const years = Math.max(0, (Date.parse(asOf) - Date.parse(p.start)) / (365.25 * 86400000));
    // Anniversary quotes represent earlier market value while the asset was
    // developing. An undated, future, or absent observation is never zero.
    const checkpoints = [p.one, p.two, p.three].filter((q): q is Quote => Boolean(q && q.date <= asOf));
    const averageHistory = checkpoints.length
      ? checkpoints.reduce((sum, quote) => sum + quote.value, 0) / checkpoints.length : null;
    const marketValue = current && averageHistory !== null
      ? 0.7 * current.value + 0.3 * averageHistory : current?.value;
    const cushion = [0, 750, 1250, 2000, 3000][Math.min(p.round, 4)];
    const marketScore = marketValue !== undefined && benchmark !== null
      ? 80 + 22 * Math.log2((marketValue + cushion) / (benchmark + cushion)) : null;

    const target: Record<string, number> = { QB: 18, RB: 12, WR: 12, TE: 9 };
    const seasonCredit = (p.seasons ?? []).reduce((sum, season) => {
      if (season.games <= 0) return sum;
      const quality = Math.max(0, Math.min(1.25, season.points / season.games / (target[p.pos] ?? 12)));
      return sum + quality * Math.min(1, season.games / 12);
    }, 0);
    // Credit sustained production and discount tiny samples. Older selections
    // have had more opportunity to produce. Recent picks stay provisional.
    const productionAdjustment = years >= 1 && p.seasons
      ? Math.max(-14, Math.min(14, 9 * seasonCredit - ([0, 12, 8, 6, 6][Math.min(p.round, 4)] + (seasonCredit < 0.35 && years >= 2 ? 4 : 0)) * Math.min(1, years / 2)))
      : 0;
    const alternatives = board.filter(x => x.overall > p.overall && x.overall <= p.overall + 4);
    const roundWeight = [0, 2.4, 1.8, 1.1, 0.6][Math.min(p.round, 4)];
    const penalty = current ? alternatives.reduce((sum, other) => {
      const value = fresh(other)?.value;
      if (value === undefined || value <= current.value * 1.1) return sum;
      const position = other.pos === p.pos ? 1.5 : 1;
      const proximity = other.overall - p.overall <= 2 ? 1.25 : 1;
      const gap = Math.min(1, (value - current.value) / Math.max(2000, current.value));
      return sum + roundWeight * position * proximity * gap;
    }, 0) : 0;
    const outcome = marketScore === null || benchmark === null ? null : {
      ...makeGrade(marketScore + productionAdjustment, Math.min(10, penalty)),
      breakdown: { benchmark, marketScore, productionAdjustment, historyQuotes: checkpoints.length, rawScore: marketScore + productionAdjustment - Math.min(10, penalty) },
    };
    return { ...p, entry, current, outcome };
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
