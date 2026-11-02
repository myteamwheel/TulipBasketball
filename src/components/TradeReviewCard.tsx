"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDateTimeEastern, formatPoints, formatSigned, formatPercent } from "@/lib/format";
import { tradeWinner, type ReviewAsset, type ReviewSide, type ReviewTrade } from "@/lib/tradeReview";
export type { ReviewAsset } from "@/lib/tradeReview";

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(part => part[0] ?? "").join("").toUpperCase();
const value = (points: number | null) => points === null ? "Unavailable" : formatPoints(points);
const grade = (side: ReviewSide, phase: "atTrade" | "current") => side.grades?.[phase].status === "EXCLUDED" ? "FAAB only" : side.grades?.[phase].grade ?? "Unrated";
const preview = (side: ReviewSide) => [...side.got.slice(0, 2).map(asset => asset.label.replace(/ \([^)]*\)$/, "")), ...(side.got.length > 2 ? ["+" + (side.got.length - 2) + " more"] : []), ...((side.faabReceived ?? 0) > 0 ? ["$" + side.faabReceived + " FAAB"] : [])].join(" · ") || "No received assets recorded";

function Assets({ title, items }: { title: string; items: ReviewAsset[] }) {
  return <div className="trade-assets"><h5>{title}</h5>{items.length ? <ul>{items.map(asset => <li key={asset.id}><div className="trade-asset-name">{asset.playerId ? <Link href={"/players/" + asset.playerId}>{asset.label}</Link> : asset.label}<span>{asset.assetType}</span></div><div className="trade-asset-values"><span>At trade <strong>{value(asset.atTradeValue)}</strong></span><span>Now <strong>{value(asset.currentValue)}</strong></span></div></li>)}</ul> : <p>No players or picks recorded.</p>}</div>;
}

export default function TradeReviewCard({ sides, trade, embedded = false }: { sides: ReviewSide[]; trade?: ReviewTrade; embedded?: boolean }) {
  const [replayPhase, setReplayPhase] = useState<"atTrade" | "current" | null>(null);
  const [shareNote, setShareNote] = useState("");
  useEffect(() => {
    if (!replayPhase) return;
    const timer = window.setTimeout(() => setReplayPhase(replayPhase === "atTrade" ? "current" : null), replayPhase === "atTrade" ? 350 : 650);
    return () => window.clearTimeout(timer);
  }, [replayPhase]);
  const shell = { id: trade?.id ?? "", date: trade?.date ?? "", sides };
  const thenWinner = tradeWinner(shell, "atTrade"), nowWinner = tradeWinner(shell, "current");
  const changed = thenWinner !== nowWinner && thenWinner !== "Unavailable" && nowWinner !== "Unavailable";
  const approximate = sides.some(side => [...side.gave, ...side.got].some(asset => asset.atMoveTiming === "NEXT_DAY_APPROXIMATION"));
  const missingThen = sides.some(side => side.grades?.atTrade.status === "INCOMPLETE");
  const missingNow = sides.some(side => side.grades?.current.status === "INCOMPLETE");
  const hasFaab = sides.some(side => (side.faabSent ?? 0) > 0 || (side.faabReceived ?? 0) > 0);
  const pricedAssets = [...new Map(sides.flatMap(side => [...side.got, ...side.gave]).map(asset => [asset.id, asset] as const)).values()];
  const readySide = sides.length === 2 ? sides.find(side => side.name === nowWinner && side.grades?.atTrade.status === "READY" && side.grades.current.status === "READY") ?? sides.find(side => side.grades?.atTrade.status === "READY" && side.grades.current.status === "READY") : null;
  const gain = readySide ? readySide.grades!.current.balance!.adjustedEdge - readySide.grades!.atTrade.balance!.adjustedEdge : null;
  const shareUrl = trade ? "https://dynasty-boys-dashboard.vercel.app/trade-review?trade=" + encodeURIComponent(trade.id) : "";
  async function share() {
    if (!shareUrl) return;
    if (navigator.share) {
      try { await navigator.share({ title: "Dynasty Boys trade review", text: sides.map(side => side.name + " received " + preview(side)).join(" | "), url: shareUrl }); return; } catch { /* User dismissed the share sheet. */ }
    }
    try { await navigator.clipboard.writeText(shareUrl); setShareNote("Link copied"); } catch { setShareNote("Copy this page address to share"); }
  }
  function saveImage() {
    if (!trade) return;
    const sectionHeights = sides.map(side => 142 + Math.max(side.got.length, side.gave.length, 1) * 36);
    const imageHeight = 220 + sectionHeights.reduce((sum, height) => sum + height + 16, 0) + 72;
    const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = imageHeight;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#6ee7b7"; ctx.font = "bold 26px sans-serif"; ctx.fillText("DYNASTY BOYS · TRADE REVIEW", 48, 62);
    ctx.fillStyle = "#e5edf8"; ctx.font = "42px sans-serif"; ctx.fillText(formatDateTimeEastern(trade.date), 48, 120);
    ctx.font = "21px sans-serif"; ctx.fillText("At trade: " + thenWinner + "   →   Now: " + nowWinner, 48, 164, 1480);
    let y = 206;
    sides.forEach((side, index) => {
      const height = sectionHeights[index];
      ctx.fillStyle = "#19273b"; ctx.fillRect(40, y, 1520, height);
      ctx.fillStyle = "#e5edf8"; ctx.font = "bold 26px sans-serif"; ctx.fillText(side.name, 58, y + 37, 610);
      ctx.fillStyle = "#6ee7b7"; ctx.font = "bold 25px sans-serif"; ctx.fillText("Then " + grade(side, "atTrade") + " " + formatSigned(side.grades?.atTrade.balance?.adjustedEdge), 690, y + 37);
      ctx.fillText("Now " + grade(side, "current") + " " + formatSigned(side.grades?.current.balance?.adjustedEdge), 1110, y + 37);
      ctx.fillStyle = "#a7b6cb"; ctx.font = "18px sans-serif";
      ctx.fillText("RECEIVED", 58, y + 71); ctx.fillText("SENT", 800, y + 71);
      const rows = Math.max(side.got.length, side.gave.length, 1);
      for (let row = 0; row < rows; row++) {
        for (const [asset, x] of [[side.got[row], 58], [side.gave[row], 800]] as const) {
          if (!asset) continue;
          ctx.fillStyle = "#e5edf8"; ctx.font = "18px sans-serif";
          ctx.fillText(asset.label + " · then " + value(asset.atTradeValue) + " · now " + value(asset.currentValue), x, y + 102 + row * 36, 705);
        }
      }
      ctx.fillStyle = "#a7b6cb"; ctx.font = "17px sans-serif";
      ctx.fillText("FAAB received $" + (side.faabReceived ?? 0) + " · sent $" + (side.faabSent ?? 0) + " (excluded from rating)", 58, y + height - 14);
      y += height + 16;
    });
    ctx.fillStyle = "#a7b6cb"; ctx.font = "18px sans-serif"; ctx.fillText("Market points · source prices and methods at " + shareUrl, 48, imageHeight - 28, 1500);
    const link = document.createElement("a"); link.href = canvas.toDataURL("image/png"); link.download = "dynasty-trade-" + trade.id + ".png"; link.click();
  }
  return <section className="trade-review-card" aria-label="Trade comparison">
    <div className="trade-review-toolbar"><div><span className="trade-eyebrow">Trade comparison</span>{embedded ? <h3>Trade outcome</h3> : <h2>Who got the better deal?</h2>}</div><div className="trade-review-actions"><button type="button" onClick={() => setReplayPhase("atTrade")} disabled={replayPhase !== null} aria-label="Replay change from trade date to now">↻ Replay</button>{trade ? <><button type="button" onClick={share}>Share</button><button type="button" onClick={saveImage}>Save image</button></> : null}</div></div>
    {shareNote ? <p role="status" className="trade-share-note">{shareNote}</p> : null}
    <div className="trade-winner-strip" aria-live="polite"><div className={replayPhase === "atTrade" ? "is-replay-focus" : ""}><span>At trade</span><strong>{thenWinner}</strong></div><span className="trade-winner-arrow" aria-hidden="true">→</span><div className={replayPhase === "current" ? "is-replay-focus" : ""}><span>Now</span><strong>{nowWinner}</strong></div>{changed ? <b className="trade-reversal-badge">{thenWinner === "Even" || nowWinner === "Even" ? "Outcome changed" : "Winner changed"}</b> : null}</div>
    <div className="trade-matrix" role="table" aria-label="Team grades and market edges at trade and now"><div className="trade-matrix-head" role="row"><span role="columnheader">Received by</span><span role="columnheader">At trade</span><span role="columnheader">Now</span></div>{sides.map(side => <div className="trade-matrix-row" role="row" key={side.rosterId}><div className="trade-team" role="cell"><span className="trade-avatar" aria-hidden="true">{initials(side.name)}</span><div><strong title={side.name}>{side.name}</strong><span>{preview(side)}</span></div></div>{(["atTrade", "current"] as const).map(phase => { const result = side.grades?.[phase]; return <div key={phase} role="cell" className={"trade-grade " + (result?.result === "WON" ? "trade-positive" : result?.result === "LOST" ? "trade-negative" : "") + (replayPhase === phase ? " is-replay-focus" : "")}><strong>{grade(side, phase)}</strong><span>{result?.balance ? formatSigned(result.balance.adjustedEdge) : "—"} <small>pts</small></span><span>{result?.balance ? formatPercent(result.balance.edgePercent) : "—"}</span></div>; })}</div>)}</div>
    <div className={"trade-change-line" + (replayPhase !== null ? " is-replaying" : "")}><span>At trade</span><i aria-hidden="true" /><span>Now</span></div>
    <p className="trade-review-caption">{gain !== null ? "Advantage change for " + readySide!.name + ": " + formatSigned(gain) + " market points. " : ""}Grades compare received with sent market value after package adjustment. They do not measure fantasy points or team fit.</p>
    <div className="trade-coverage">{approximate ? <span className="trade-warning">Next day historical approximation</span> : null}{missingThen ? <span className="trade-warning">At-trade prices missing</span> : null}{missingNow ? <span className="trade-warning">Current prices missing</span> : null}{hasFaab ? <span>FAAB recorded · excluded from grades</span> : null}</div>
    <section className="trade-packages" aria-label="Full trade packages"><h3>Who received and sent what</h3><div className="trade-detail-grid">{sides.map(side => <section key={side.rosterId}><h4>{side.name}</h4><div className="trade-detail-columns"><Assets title="Received" items={side.got} /><Assets title="Sent" items={side.gave} /></div>{(side.faabReceived ?? 0) + (side.faabSent ?? 0) > 0 ? <p>FAAB received {"$" + (side.faabReceived ?? 0)} · sent {"$" + (side.faabSent ?? 0)}. Excluded from ratings.</p> : null}{side.grades?.atTrade.reason || side.grades?.current.reason ? <p>Coverage: {side.grades.atTrade.reason ?? "Historical complete."} {side.grades.current.reason ?? "Current complete."}</p> : null}</section>)}</div></section>
    {pricedAssets.length ? <details className="trade-details trade-source-details"><summary>Price source dates</summary><ul>{pricedAssets.map(asset => <li key={asset.id}><strong>{asset.label}</strong><span>{asset.atMoveObservedAt ? "Historical " + formatDateTimeEastern(asset.atMoveObservedAt) + (asset.atMoveTiming === "NEXT_DAY_APPROXIMATION" ? " · next day approximation" : "") : "Historical price unavailable"} · {asset.currentObservedAt ? "Current " + formatDateTimeEastern(asset.currentObservedAt) : "Current source unavailable"}</span></li>)}</ul></details> : null}
    <details className="trade-details trade-method"><summary>How scores and winners are calculated</summary><div><p>Market edge is adjusted received value minus adjusted sent value, in market points. Percentage divides the edge by the larger package. Within 3% is even (B). Positive edges above 3%, 8%, 15%, and 25% earn B+, A−, A, and A+. Losing grades are B−, C+, C, and D.</p><p>The highest-value asset keeps its full price. Additional pieces receive a consolidation discount. Historical values use a verified observation within 24 hours before the trade or a labeled first observation within 24 hours after it. Current prices must be fresh. Pick prices are generic round averages. Missing prices withhold the affected grade. FAAB is always excluded.</p>{sides.length > 2 ? <p>Each team in a multi-team trade is compared with its own outgoing package, so several teams can have positive edges.</p> : null}</div></details>
  </section>;
}
