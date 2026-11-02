"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPoints, formatSigned } from "@/lib/format";
type Snapshot = { playerCapital: number; rosterCount: number; lineupIssues: number; observedAt: string | null };
const KEY = "dynasty-last-visit";
export default function SinceLastVisit({ current }: { current: Snapshot }) {
  const [previous, setPrevious] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Snapshot;
          if (Number.isFinite(parsed.playerCapital) && Number.isFinite(parsed.rosterCount) && Number.isFinite(parsed.lineupIssues)) setPrevious(parsed);
        }
        localStorage.setItem(KEY, JSON.stringify(current));
      } catch { /* Private browsing can make storage unavailable. */ }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [current]);
  if (!loaded) return <section className="home-visit-card" aria-label="Changes since last visit"><h2>Since your last visit</h2><p>Checking your last saved dashboard view…</p></section>;
  const capitalDelta = previous ? current.playerCapital - previous.playerCapital : null;
  const rosterDelta = previous ? current.rosterCount - previous.rosterCount : null;
  const issuesDelta = previous ? current.lineupIssues - previous.lineupIssues : null;
  const unchanged = previous && capitalDelta === 0 && rosterDelta === 0 && issuesDelta === 0;
  return <section className="home-visit-card"><div className="home-visit-head"><div><span className="trade-eyebrow">Your team</span><h2>Since your last visit</h2></div><Link href="/refresh-history">Data history →</Link></div>{!previous ? <p>This is your first saved view on this device. Future visits will compare your player capital, roster count, and lineup issues with this snapshot.</p> : unchanged ? <p>No change in these tracked figures since your last visit. Current known player capital: {formatPoints(current.playerCapital)} market points.</p> : <div className="home-visit-metrics"><div><span>Known player capital</span><strong className={capitalDelta! >= 0 ? "up" : "down"}>{formatSigned(capitalDelta)} pts</strong></div><div><span>Roster entries</span><strong>{formatSigned(rosterDelta)}</strong></div><div><span>Lineup issues</span><strong className={issuesDelta! > 0 ? "down" : issuesDelta! < 0 ? "up" : ""}>{formatSigned(issuesDelta)}</strong></div></div>}<small>Compared with the last view saved in this browser. Market values update with verified refreshes; missing player prices are not counted as zero.</small></section>;
}
