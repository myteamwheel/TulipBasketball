"use client";
import { exportGradeColor, exportGradeLabel, wrapExportText } from "@/lib/tradeImage";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDateTimeEastern, formatPoints, formatSigned, formatPercent } from "@/lib/format";
import { currentOutcomeGrade, tradeWinner, type ReviewAsset, type ReviewSide, type ReviewTrade } from "@/lib/tradeReview";
export type { ReviewAsset } from "@/lib/tradeReview";

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(part => part[0] ?? "").join("").toUpperCase();
const value = (points: number | null) => points === null ? "Unavailable" : formatPoints(points);
const grade = (side: ReviewSide, phase: "atTrade" | "current") => side.grades?.[phase].status === "EXCLUDED" ? "FAAB only" : side.grades?.[phase].grade ?? "Unrated";
function dailyLabel(asset: ReviewAsset) {
  const method = asset.historicalDaily?.method;
  if (method === 'ARCHIVED_KTC_POST_TRADE') return asset.assetType === 'pick' ? 'post-trade KTC round average · estimate' : 'post-trade KTC · estimate';
  if (method?.includes('ROUND_AVERAGE')) return 'prior-day KTC round average';
  return method === 'ARCHIVED_KTC_PLAYER' ? 'archived prior-day KTC' : 'prior-day KTC';
}
const historicalQuoteDate = (quote: NonNullable<ReviewAsset['historicalDaily']>) => quote.observedAt ? formatDateTimeEastern(quote.observedAt) : quote.date;
const receivedSummary = (side: ReviewSide) => [...side.got.map(asset => asset.label), ...((side.faabReceived ?? 0) > 0 ? ["$" + side.faabReceived + " FAAB"] : [])].join(" · ") || "No received assets recorded";

function AssetDetail({ asset }: { asset: ReviewAsset }) {
  return <li><div>{asset.playerId ? <Link href={'/players/' + asset.playerId}>{asset.label}</Link> : asset.label}</div><div className="trade-inline-prices"><span>Then <b>{value(asset.atTradeValue)}</b>{asset.historicalDaily ? <small> · <a href={asset.historicalDaily.sourceUrls[0]} target="_blank" rel="noreferrer">{dailyLabel(asset)} ({historicalQuoteDate(asset.historicalDaily)})</a></small> : null}</span><span aria-hidden="true">→</span><span>Now <b>{asset.outcome ? 'Pick used' : value(asset.currentValue)}</b></span></div>{asset.outcome ? <div className="trade-pick-outcome">Became {asset.outcome.playerId ? <Link href={'/players/' + asset.outcome.playerId}>{asset.outcome.label}</Link> : asset.outcome.label} · #{asset.outcome.pickNumber}<br/>Player now: {value(asset.outcome.currentValue)} market pts <a href={asset.outcome.sourceUrl} target="_blank" rel="noreferrer">Draft record ↗</a></div> : null}{asset.journey?.length ? <details className="trade-journey"><summary>{asset.journey.length} later trade{asset.journey.length === 1 ? '' : 's'}</summary>{asset.journey.map(step => <Link key={step.tradeId} href={'/trade-review?trade=' + encodeURIComponent(step.tradeId)}>{formatDateTimeEastern(step.date)} · {step.label}</Link>)}<small>Asset path only; later returns are not credited to the original recipient.</small></details> : null}</li>;
}

export default function TradeReviewCard({ sides, trade, embedded = false }: { sides: ReviewSide[]; trade?: ReviewTrade; embedded?: boolean }) {
  const [replayPhase, setReplayPhase] = useState<"atTrade" | "current" | null>(null);
  const [shareNote, setShareNote] = useState("");
  useEffect(() => {
    if (!replayPhase) return;
    const timer = window.setTimeout(() => setReplayPhase(replayPhase === "atTrade" ? "current" : null), replayPhase === "atTrade" ? 900 : 1200);
    return () => window.clearTimeout(timer);
  }, [replayPhase]);
  const shell = { id: trade?.id ?? "", date: trade?.date ?? "", sides };
  const thenWinner = tradeWinner(shell, "atTrade"), nowWinner = tradeWinner(shell, "current");
  const changed = thenWinner !== nowWinner && thenWinner !== "Unavailable" && nowWinner !== "Unavailable";
  const approximate = sides.some(side => [...side.gave, ...side.got].some(asset => asset.atMoveTiming === "NEXT_DAY_APPROXIMATION" || asset.historicalDaily?.method === "ARCHIVED_KTC_POST_TRADE"));
  const missingThen = sides.some(side => (side.grades?.atTrade.missingAssets.length ?? 0) > 0);
  const dailyHistory = sides.some(side => [...side.gave, ...side.got].some(asset => asset.historicalDaily && !asset.historicalDaily.observedAt));
  const missingNow = sides.some(side => (side.grades?.current.missingAssets.length ?? 0) > 0);
  const hasFaab = sides.some(side => (side.faabSent ?? 0) > 0 || (side.faabReceived ?? 0) > 0);
  const pricedAssets = [...new Map(sides.flatMap(side => [...side.got, ...side.gave]).map(asset => [asset.id, asset] as const)).values()];
  const readySide = sides.length === 2 ? sides.find(side => side.name === nowWinner && side.grades?.atTrade.status === "READY" && side.grades.current.status === "READY") ?? sides.find(side => side.grades?.atTrade.status === "READY" && side.grades.current.status === "READY") : null;
  const gain = readySide ? readySide.grades!.current.balance!.adjustedEdge - readySide.grades!.atTrade.balance!.adjustedEdge : null;
  const shareUrl = trade ? "https://dynasty-boys-dashboard.vercel.app/trade-review?trade=" + encodeURIComponent(trade.id) : "";
  async function share() {
    if (!shareUrl) return;
    if (navigator.share) {
      try { await navigator.share({ title: "Dynasty Boys trade review", text: sides.map(side => side.name + " received " + receivedSummary(side)).join(" | "), url: shareUrl }); return; } catch { /* User dismissed the share sheet. */ }
    }
    try { await navigator.clipboard.writeText(shareUrl); setShareNote("Link copied"); } catch { setShareNote("Copy this page address to share"); }
  }
  function saveImage() {
    if (!trade) return;
    const canvas = document.createElement('canvas'); canvas.width = 1600;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.font = '24px sans-serif';
    const measure = (text: string) => ctx.measureText(text).width;
    const sections = sides.map(side => {
      const lines: { text: string; color: string; bold?: boolean }[] = [];
      const add = (text: string, color = '#e5edf8', bold = false) => {
        ctx.font = bold ? 'bold 26px sans-serif' : '24px sans-serif';
        lines.push(...wrapExportText(text, 1450, measure).map(text => ({ text, color, bold })));
      };
      add(side.name, '#e5edf8', true);
      add(exportGradeLabel(side, 'atTrade'), exportGradeColor(side, 'atTrade'));
      add(exportGradeLabel(side, 'current'), exportGradeColor(side, 'current'));
      add('RECEIVED');
      for (const asset of side.got) {
        add(asset.label);
        add(`At trade ${value(asset.atTradeValue)}${asset.historicalDaily ? ' (' + dailyLabel(asset) + ' ' + historicalQuoteDate(asset.historicalDaily) + ')' : ''} → Now ${asset.outcome ? 'pick used' : value(asset.currentValue)} market pts`);
        if (asset.outcome) add(`Became ${asset.outcome.label} · current player value ${value(asset.outcome.currentValue)} (separate outcome)`);
      }
      if (!side.got.length) add('No players or picks received');
      add(`FAAB received $${side.faabReceived ?? 0} · sent $${side.faabSent ?? 0} — excluded from grades`);
      for (const phase of ['atTrade', 'current'] as const) if (side.grades?.[phase].missingAssets.length) add(`${phase === 'atTrade' ? 'Historical' : 'Current'} missing prices: ${side.grades[phase].missingAssets.join(', ')}`);
      return lines;
    });
    ctx.font = '26px sans-serif';
    const winnerLines = wrapExportText(`At trade: ${thenWinner} → Now: ${nowWinner}`, 1480, measure);
    const sectionStart = Math.max(176 + winnerLines.length * 32, 230);
    canvas.height = sectionStart + sections.reduce((n, lines) => n + lines.length * 38 + 40, 0) + 110;
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#6ee7b7'; ctx.font = 'bold 30px sans-serif'; ctx.fillText('DYNASTY BOYS · TRADE REVIEW', 48, 58);
    ctx.fillStyle = '#e5edf8'; ctx.font = '26px sans-serif'; ctx.fillText(formatDateTimeEastern(trade.date), 48, 110);
    let y = 156;
    for (const line of winnerLines) { ctx.fillText(line, 48, y); y += 32; }
    y = sectionStart;
    for (const lines of sections) {
      ctx.fillStyle = '#19273b'; ctx.fillRect(36, y - 25, 1528, lines.length * 38 + 20);
      for (const line of lines) {
        ctx.font = line.bold ? 'bold 26px sans-serif' : '24px sans-serif';
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, 58, y); y += 38;
      }
      y += 40;
    }
    ctx.font = '20px sans-serif'; ctx.fillStyle = '#a7b6cb';
    ctx.fillText('Each receiving package is shown once. Market grades exclude FAAB and downstream trades.', 48, y);
    ctx.fillText(shareUrl, 48, y + 32);
    const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = 'dynasty-trade-' + trade.id + '.png'; link.click();
  }
  const replaySide = sides[0];
  const replayGrade = replaySide?.grades?.[replayPhase ?? 'current'];
  const replayShare = replayGrade?.balance ? Math.max(0, Math.min(100, 50 + replayGrade.balance.edgePercent / 2)) : 50;
  const replay = () => {
    const reduced = document.documentElement.dataset.motion === 'reduced' || document.documentElement.dataset.motion !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setShareNote('At trade: ' + thenWinner + '. Now: ' + nowWinner + '.'); return; }
    setReplayPhase('atTrade');
  };
  return <section className="trade-review-card" aria-label="Trade comparison">
    <div className="trade-review-toolbar"><div><span className="trade-eyebrow">Trade comparison</span>{embedded ? <h3>Trade outcome</h3> : <h2>Who got the better deal?</h2>}</div><div className="trade-review-actions"><button type="button" onClick={replay} disabled={replayPhase !== null} aria-label="Replay change from trade date to now">↻ Replay</button>{trade ? <><button type="button" onClick={share}>Share</button><button type="button" onClick={saveImage}>Save image</button></> : null}</div></div>
    {shareNote ? <p role="status" className="trade-share-note">{shareNote}</p> : null}
    <p className="section-freshness">Current prices as of {formatDateTimeEastern(pricedAssets.map(a => a.currentObservedAt).filter((v): v is string => !!v).sort()[0] ?? null)} · Historical prices retain their original observation dates.</p>
    <div className="trade-winner-strip" aria-live="polite"><div className={replayPhase === "atTrade" ? "is-replay-focus" : ""}><span>At trade</span><strong>{thenWinner}</strong></div><span className="trade-winner-arrow" aria-hidden="true">→</span><div className={replayPhase === "current" ? "is-replay-focus" : ""}><span>Now</span><strong>{nowWinner}</strong></div>{changed ? <b className="trade-reversal-badge">{thenWinner === "Even" || nowWinner === "Even" ? "Outcome changed" : "Winner changed"}</b> : null}</div>
    {pricedAssets.some(asset => asset.outcome) ? <p className="trade-review-caption">Used picks no longer have a current pick price. The drafted-player outcome below compares the players those picks became; the original at-trade grade keeps the pick’s historical value.</p> : null}
    <div className="trade-matrix" role="table" aria-label="Team grades and market edges at trade and now"><div className="trade-matrix-head" role="row"><span role="columnheader">Received by</span><span role="columnheader">At trade</span><span role="columnheader">Now</span></div>{sides.map(side => <div className="trade-matrix-row" role="row" key={side.rosterId}><div className="trade-team" role="cell"><span className="trade-avatar" aria-hidden="true">{initials(side.name)}</span><div><strong>{side.name}</strong><ul className="trade-received-assets" aria-label={side.name + " received"}>{side.got.map(asset => <AssetDetail asset={asset} key={asset.id} />)}{(side.faabReceived ?? 0) > 0 ? <li className="trade-received-faab">${side.faabReceived} FAAB <span>Excluded from grades</span></li> : null}{!side.got.length && !(side.faabReceived ?? 0) ? <li>No received assets recorded</li> : null}</ul></div></div>{(["atTrade", "current"] as const).map(phase => { const result = side.grades?.[phase]; return <div key={phase} role="cell" className={"trade-grade " + (result?.result === "WON" ? "trade-positive" : result?.result === "LOST" ? "trade-negative" : "") + (replayPhase === phase ? " is-replay-focus" : "")}><strong>{grade(side, phase)}</strong><span>{result?.balance ? formatSigned(result.balance.adjustedEdge) : "—"} <small>pts</small></span><span>{result?.balance ? formatPercent(result.balance.edgePercent) : "—"}</span>{result?.status === 'INCOMPLETE' ? <div className="trade-grade-missing"><b>{result.missingAssets.length ? (phase === 'atTrade' ? 'Historical prices missing' : 'Current prices missing') : 'No two-sided grade'}</b>{result.missingAssets.length ? <ul>{result.missingAssets.map((label, index) => <li key={index}>{label}</li>)}</ul> : <p>{result.reason}</p>}</div> : null}</div>; })}</div>)}</div>
    <div className={"trade-change-line" + (replayPhase !== null ? " is-replaying" : "")}><span>{replaySide?.name} · {replayPhase === 'atTrade' ? 'At trade' : 'Now'}</span><div className="trade-advantage-track" role="img" aria-label={replayGrade?.balance ? `${replaySide.name} market edge ${formatPercent(replayGrade.balance.edgePercent)}` : 'Advantage unavailable'}><i style={{ width: replayShare + '%' }} /></div><strong>{replayGrade?.balance ? formatSigned(replayGrade.balance.adjustedEdge) + ' pts' : 'Unrated'}</strong></div>
    <p className="trade-review-caption">{gain !== null ? "Advantage change for " + readySide!.name + ": " + formatSigned(gain) + " market points. " : ""}Grades compare received with sent market value after package adjustment. They do not measure fantasy points or team fit.</p>
    <div className="trade-coverage">{dailyHistory ? <span className="trade-warning">Prior-day KTC values · daily precision</span> : null}{approximate ? <span className="trade-warning">Post-trade price approximation</span> : null}{missingThen ? <span className="trade-warning">At-trade prices missing</span> : null}{missingNow ? <span className="trade-warning">Current prices missing</span> : null}{hasFaab ? <span>FAAB recorded · excluded from grades</span> : null}</div>
    {sides.some(side => side.got.some(asset => asset.outcome)) ? <section className="trade-outcome-summary"><h3>Drafted-player outcome · separate from the original grade</h3><p>Replaces used picks with their drafted players at fresh current prices. Later trades are linked above and are not added to this score.</p>{sides.map(side => {
      const outcome = currentOutcomeGrade(side);
      return <div key={side.rosterId}><strong>{side.name}</strong><span>{outcome?.grade ?? 'Unrated'} · {outcome?.balance ? formatSigned(outcome.balance.adjustedEdge) + ' market pts' : 'Missing fresh prices: ' + (outcome?.missingAssets.join(', ') || 'Unavailable')}</span></div>;
    })}</section> : null}
    {sides.length > 2 ? <section className="trade-multiteam-sent"><h3>Multi-team outgoing packages</h3>{sides.map(side => <div key={side.rosterId}><strong>{side.name} sent</strong><ul>{side.gave.map(asset => <li key={asset.id}>{asset.label}</li>)}</ul></div>)}</section> : null}
    <p className="trade-faab-summary">{hasFaab ? sides.map(side => `${side.name}: FAAB received $${side.faabReceived ?? 0} · sent $${side.faabSent ?? 0}`).join(' | ') + '. Excluded from ratings.' : 'Each received package is shown once. In a two-team trade, the other team sent that package.'}</p>
    {pricedAssets.length ? <details className="trade-details trade-source-details"><summary>Price source dates</summary><ul>{pricedAssets.map(asset => <li key={asset.id}><strong>{asset.label}</strong><span>{asset.atMoveObservedAt ? "Historical " + formatDateTimeEastern(asset.atMoveObservedAt) + (asset.atMoveTiming === "NEXT_DAY_APPROXIMATION" ? " · next day approximation" : "") : asset.historicalDaily ? dailyLabel(asset) + ": " + historicalQuoteDate(asset.historicalDaily) : "Historical price unavailable"} · {asset.currentObservedAt ? "Current " + formatDateTimeEastern(asset.currentObservedAt) : "Current source unavailable"}</span></li>)}</ul></details> : null}
    <details className="trade-details trade-method"><summary>How scores and winners are calculated</summary><div><p>Market edge is adjusted received value minus adjusted sent value, in market points. Percentage divides the edge by the larger package. Within 3% is even (B). Positive edges above 3%, 8%, 15%, and 25% earn B+, A−, A, and A+. Losing grades are B−, C+, C, and D.</p><p>The highest-value asset keeps its full price. Additional pieces receive a consolidation discount. Historical values use a verified observation within 24 hours before the trade or a labeled first observation within 24 hours after it. When those are absent, a labeled KTC daily chart value from the preceding UTC date may be used; it has day precision, not an exact trade-time timestamp. Current prices must be fresh. Pick prices are generic round averages. Recovered pick prices require Early, Mid, and Late quotes from the same dated source; their average is labeled and linked to the official profiles or public historical archive. Missing prices withhold the affected grade. FAAB is always excluded.</p>{sides.length > 2 ? <p>Each team in a multi-team trade is compared with its own outgoing package, so several teams can have positive edges.</p> : null}</div></details>
  </section>;
}
