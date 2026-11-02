"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatDateEastern, formatPoints, formatSigned, formatPercent } from "@/lib/format";
import { coverage, rankTrades, tradeWinner, type ReviewFilters, type ReviewMetric, type ReviewSort, type ReviewTrade } from "@/lib/tradeReview";
import TradeReviewCard from "@/components/TradeReviewCard";

const PAGE_SIZE = 15;
const defaults: ReviewFilters = { team: null, season: "all", opponent: null, asset: "all", faab: "all" };
const sortOptions: { value: ReviewSort; label: string }[] = [
  { value: "newest", label: "Newest trades" },
  { value: "winsThen", label: "Biggest wins at trade" },
  { value: "winsNow", label: "Biggest wins now" },
  { value: "improved", label: "Most improved advantage" },
  { value: "reversals", label: "Biggest reversals" },
  { value: "losses", label: "Biggest losses now" },
  { value: "largest", label: "Largest deals" },
];
const validSort = (value: unknown): value is ReviewSort => sortOptions.some(option => option.value === value);
const validFilters = (value: unknown): value is ReviewFilters => typeof value === "object" && value !== null && "season" in value && "asset" in value && "faab" in value && "team" in value && "opponent" in value;
const labelScore = (score: number | null, metric: ReviewMetric) => score === null ? "—" : metric === "percent" ? formatPercent(score) : formatSigned(score) + " pts";

export default function TradeReviewBoard({ trades, initialTrade }: { trades: ReviewTrade[]; initialTrade?: string }) {
  const [mode, setMode] = useState<"history" | "wins">("history");
  const [sort, setSort] = useState<ReviewSort>("newest");
  const [metric, setMetric] = useState<ReviewMetric>("points");
  const [filters, setFilters] = useState<ReviewFilters>(defaults);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousRects = useRef<Map<string, DOMRect>>(new Map());
  const teams = useMemo(() => [...new Map(trades.flatMap(trade => trade.sides.map(side => [side.rosterId, side.name] as const))).entries()].sort((a, b) => a[1].localeCompare(b[1])), [trades]);
  const seasons = useMemo(() => [...new Set(trades.map(trade => new Date(trade.date).getUTCFullYear().toString()))].sort().reverse(), [trades]);
  const totals = useMemo(() => coverage(trades), [trades]);
  const ranked = useMemo(() => rankTrades(trades, sort, metric, filters), [trades, sort, metric, filters]);
  const visible = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedTrade = initialTrade ? trades.find(trade => trade.id === initialTrade) : null;
  const pageCount = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  const capture = () => {
    previousRects.current = new Map([...listRef.current?.querySelectorAll<HTMLElement>("[data-trade-id]") ?? []].map(node => [node.dataset.tradeId ?? "", node.getBoundingClientRect()]));
  };
  useLayoutEffect(() => {
    if (!ready || matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced") { previousRects.current.clear(); return; }
    for (const node of listRef.current?.querySelectorAll<HTMLElement>("[data-trade-id]") ?? []) {
      const before = previousRects.current.get(node.dataset.tradeId ?? "");
      if (!before) continue;
      const after = node.getBoundingClientRect();
      const delta = before.top - after.top;
      if (Math.abs(delta) > 1 && Math.abs(delta) < 1500) node.animate([{ transform: "translateY(" + delta + "px)" }, { transform: "translateY(0)" }], { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" });
    }
    previousRects.current.clear();
  }, [ranked, page, ready]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("dynasty-trade-review") ?? "{}") as Record<string, unknown>;
        if (saved.mode === "wins" || saved.mode === "history") setMode(saved.mode);
        if (validSort(saved.sort)) setSort(saved.sort);
        if (saved.metric === "percent" || saved.metric === "points") setMetric(saved.metric);
        if (validFilters(saved.filters)) {
          const f = saved.filters;
          setFilters({ team: typeof f.team === "number" && teams.some(([id]) => id === f.team) ? f.team : null, season: typeof f.season === "string" && seasons.includes(f.season) ? f.season : "all", opponent: typeof f.opponent === "number" && teams.some(([id]) => id === f.opponent) ? f.opponent : null, asset: f.asset === "pick" || f.asset === "player" ? f.asset : "all", faab: f.faab === "yes" || f.faab === "no" ? f.faab : "all" });
        }
      } catch { /* Private browsing can make storage unavailable. */ }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [teams, seasons]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem("dynasty-trade-review", JSON.stringify({ mode, sort, metric, filters })); } catch { /* View works without persistence. */ }
  }, [mode, sort, metric, filters, ready]);
  function changeSort(next: ReviewSort) { capture(); setSort(next); setMode(next === "newest" ? "history" : "wins"); setPage(1); }
  function changeFilter(next: Partial<ReviewFilters>) { capture(); setFilters(current => ({ ...current, ...next })); setPage(1); }
  return <div className="trade-board">
    <header className="trade-board-intro"><div><p className="trade-eyebrow">League ledger</p><h1>Trade Review</h1><p>Compare what each team received at the time of the deal and at today’s fresh market prices.</p></div><div className="trade-board-stats"><strong>{totals.total}</strong><span>recorded trades</span><small>{seasons.length ? seasons[seasons.length - 1] + "–" + seasons[0] : "No seasons yet"}</small></div></header>
    <div className="trade-coverage-summary"><span><strong>{totals.atTrade}</strong> with at-trade grades</span><span><strong>{totals.current}</strong> with current grades</span><span><strong>{totals.both}</strong> comparable in both periods</span></div>
    {selectedTrade ? <section className="trade-deep-link"><div className="trade-deep-link-head"><strong>Shared trade · {formatDateEastern(selectedTrade.date)}</strong><a href="/trade-review">See all trades</a></div><TradeReviewCard trade={selectedTrade} sides={selectedTrade.sides} /></section> : initialTrade ? <p className="trade-empty">The linked trade was not found in the recorded league history.</p> : null}
    <div className="trade-board-controls"><div className="trade-board-tabs" role="group" aria-label="Trade review view"><button type="button" className={mode === "history" ? "is-active" : ""} aria-pressed={mode === "history"} onClick={() => changeSort("newest")}>Trade history</button><button type="button" className={mode === "wins" ? "is-active" : ""} aria-pressed={mode === "wins"} onClick={() => changeSort("winsNow")}>Biggest wins</button></div><div className="trade-board-sort"><label>Sort by <select value={sort} onChange={event => changeSort(event.target.value as ReviewSort)}>{sortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Rank <select value={sort === "newest" || sort === "largest" ? "points" : metric} disabled={sort === "newest" || sort === "largest"} onChange={event => { capture(); setMetric(event.target.value as ReviewMetric); setPage(1); }}><option value="points">Market points</option><option value="percent">Percentage</option></select></label></div></div>
    <div className="trade-board-filters" aria-label="Filter trades"><label>Team<select value={filters.team ?? "all"} onChange={event => changeFilter({ team: event.target.value === "all" ? null : Number(event.target.value), opponent: null })}><option value="all">All teams</option>{teams.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label><label>Season<select value={filters.season} onChange={event => changeFilter({ season: event.target.value })}><option value="all">All seasons</option>{seasons.map(season => <option value={season} key={season}>{season}</option>)}</select></label><label>Opponent<select value={filters.opponent ?? "all"} onChange={event => changeFilter({ opponent: event.target.value === "all" ? null : Number(event.target.value) })}><option value="all">All opponents</option>{teams.filter(([id]) => id !== filters.team).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label><label>Assets<select value={filters.asset} onChange={event => changeFilter({ asset: event.target.value as ReviewFilters["asset"] })}><option value="all">Players and picks</option><option value="player">Has players</option><option value="pick">Has picks</option></select></label><label>FAAB<select value={filters.faab} onChange={event => changeFilter({ faab: event.target.value as ReviewFilters["faab"] })}><option value="all">Any</option><option value="yes">With FAAB</option><option value="no">Without FAAB</option></select></label></div>
    <p className="trade-board-help">{mode === "wins" ? "Ranks every eligible recorded trade before pagination. The named team is the perspective for each edge; choose a team to see its own wins or losses. " : ""}Market points are adjusted package value, not fantasy points. Missing prices exclude only the affected ranking period. FAAB-only transfers have no market grade.</p>
    <div className="trade-results-head"><strong>{ranked.length} {mode === "wins" ? "eligible ranked trades" : "matching trades"}</strong><span>Page {Math.min(page, pageCount)} of {pageCount}</span></div>
    <div ref={listRef} className="trade-results">{visible.map((row, index) => {
      const trade = row.trade, side = row.side;
      const isExpanded = expanded === trade.id;
      const then = tradeWinner(trade, "atTrade"), now = tradeWinner(trade, "current");
      const scoreText = sort === "newest" ? formatDateEastern(trade.date) : sort === "largest" ? formatPoints(row.score) + " pts total" : metric === "percent" && (sort === "improved" || sort === "reversals") ? formatPercent(row.score).replace("%", " pp") : labelScore(sort === "losses" ? -(row.score ?? 0) : row.score, metric);
      const perspective = sort === "newest" ? "Open comparison" : sort === "largest" ? "Total adjusted deal size" : side ? side.name + " perspective" : "No rated side";
      return <article data-trade-id={trade.id} key={trade.id} className="trade-result"><button type="button" className="trade-result-summary" aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? null : trade.id)}><span className="trade-result-rank">{mode === "wins" ? "#" + ((page - 1) * PAGE_SIZE + index + 1) : "↔"}</span><span className="trade-result-main"><strong>{trade.sides.map(item => item.name).join(" ↔ ")}</strong><small>{formatDateEastern(trade.date)} · {perspective}</small></span><span className="trade-result-winners"><span>Then <strong>{then}</strong></span><span>Now <strong>{now}</strong></span></span><span className={"trade-result-score" + (sort === "losses" ? " is-loss" : "")}>{scoreText}</span><span aria-hidden="true" className="trade-result-chevron">{isExpanded ? "−" : "+"}</span></button>{isExpanded ? <div className="trade-result-detail"><TradeReviewCard trade={trade} sides={trade.sides} /></div> : null}</article>;
    })}{!visible.length ? <div className="trade-empty"><strong>No trades match this view.</strong><p>Try another period, team, or asset filter. Trades without the prices needed for this ranking are excluded.</p></div> : null}</div>
    {pageCount > 1 ? <nav className="trade-pagination" aria-label="Trade pages"><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1); setExpanded(null); }}>← Previous</button><span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, ranked.length)} of {ranked.length}</span><button type="button" disabled={page >= pageCount} onClick={() => { setPage(value => value + 1); setExpanded(null); }}>Next →</button></nav> : null}
  </div>;
}
