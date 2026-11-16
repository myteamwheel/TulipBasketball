export type Quote = { value: number; date: string };
export type Selection = {
  id: string; draft: string; year: number; auction: boolean; start: string; overall: number;
  round: number; teams: number; bid: number | null; playerId: string; name: string; pos: string;
  owner: string | null; manager: string | null; team: string | null; profile: string | null;
  at: Quote | null; two: Quote | null; due: string; now: Quote | null; games: number; points: number;
};
export type Grade = { letter: string; score: number; edge: number };
export type GradedPick = Selection & { entry: Grade | null; outcome: Grade | null; current: Quote | null };
export type Lens = "entry" | "outcome";

export function pickLabel(p: Selection) {
  return p.auction ? `$${p.bid} bid · #${p.overall}` : `${p.round}.${String((p.overall - 1) % p.teams + 1).padStart(2, "0")}`;
}

// Average the positions occupied by tied values. Zero is a genuine observation.
function percentiles(picks: Selection[], metric: (p: Selection) => number | null) {
  const sorted = picks.flatMap(p => {
    const value = metric(p);
    return value === null ? [] : [{ id: p.id, value }];
  }).sort((a,b) => a.value-b.value);
  const result = new Map<string,number>();
  if (sorted.length < 2) return result;
  for (let i=0; i<sorted.length;) {
    let end = i+1;
    while (end < sorted.length && sorted[i].value === sorted[end].value) end++;
    const rank = ((i+end-1)/2)/(sorted.length-1);
    for (; i<end; i++) result.set(sorted[i].id,rank);
  }
  return result;
}

function grade(edge: number): Grade {
  const score = Math.round(Math.max(0,Math.min(100,80+100*edge)));
  return { score, edge, letter: score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F" };
}

export function gradeDrafts(picks: Selection[], asOf: string): GradedPick[] {
  const drafts = new Map<string, Selection[]>();
  for (const pick of picks) {
    if (!drafts.has(pick.draft)) drafts.set(pick.draft, []);
    drafts.get(pick.draft)!.push(pick);
  }
  const oldest = new Date(Date.parse(asOf.slice(0,10)) - 2*86400000).toISOString().slice(0,10);
  const fresh = (p: Selection) => p.now && p.now.date >= oldest && p.now.date <= asOf ? p.now : null;
  return [...drafts.values()].flatMap(board => {
    const cost = (p: Selection) => p.auction ? p.bid : -p.overall;
    const entryBoard = board.filter(p=>p.at !== null);
    const entryCost = percentiles(entryBoard,cost);
    const entryMarket = percentiles(entryBoard,p=>p.at!.value);
    const nowMarket = percentiles(board,p=>fresh(p)?.value ?? null);
    const nowCost = percentiles(board.filter(p=>fresh(p)),cost);
    return board.map(p=>{
      const relative = (market: Map<string,number>, expected: Map<string,number>) => {
        const m = market.get(p.id), e = expected.get(p.id);
        return m === undefined || e === undefined ? null : m-e;
      };
      const entry = relative(entryMarket,entryCost);
      const currentEdge = relative(nowMarket,nowCost);
      return { ...p, entry: entry === null ? null : grade(entry), current:fresh(p),
        outcome:currentEdge === null ? null : grade(currentEdge) };
    });
  });
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
