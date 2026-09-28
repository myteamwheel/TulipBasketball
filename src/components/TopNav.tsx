"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const groups = [
  { label: "My Team", href: "/", links: [{ href: "/", label: "Overview" }] },
  { label: "Forecast", href: "/forecast", links: [{ href: "/forecast", label: "Predictions" }, { href: "/projections", label: "Projected Points" }] },
  { label: "Team Outlook", href: "/team-outlook", links: [{ href: "/team-outlook", label: "Team Outlook" }] },
  { label: "League", href: "/league", links: [{ href: "/league", label: "League" }, { href: "/players", label: "Players" }, { href: "/transactions", label: "Transactions" }] },
  { label: "Trades & Waivers", href: "/trade-finder", links: [{ href: "/trade-finder", label: "Trade Lab" }, { href: "/waivers", label: "Waivers" }] },
  { label: "Data", href: "/audit", links: [{ href: "/audit", label: "Audit" }, { href: "/audit/report", label: "Full Report" }, { href: "/refresh-history", label: "Refreshes" }, { href: "/settings", label: "Data Health" }, { href: "/data-export", label: "Export" }] },
];

export default function TopNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current?.querySelectorAll("details[open]").forEach((menu) => {
      menu.removeAttribute("open");
    });
  }, [pathname]);
  return (
    <nav ref={navRef} aria-label="Primary" className="grid grid-cols-2 gap-1 py-1 sm:flex sm:flex-wrap">
      {groups.map((group) => {
        const active = group.links.some((link) => link.href === "/" ? pathname === "/" : pathname.startsWith(link.href));
        if (group.links.length === 1) return <Link key={group.label} href={group.href} aria-current={active ? "page" : undefined} className={`rounded-md px-3 py-2 text-center text-xs font-medium ${active ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-900 hover:text-white"}`}>{group.label}</Link>;
        return (
          <details key={group.label} className="group relative sm:w-auto" onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) event.currentTarget.open = false;
          }} onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.open = false;
          }}>
            <summary className={`cursor-pointer list-none rounded-md px-3 py-2 text-center text-xs font-medium [&::-webkit-details-marker]:hidden ${active ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-900 hover:text-white"}`}>{group.label} <span aria-hidden="true" className="ml-1 text-[10px]">▾</span></summary>
            <div className="absolute left-0 z-50 mt-1 min-w-48 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-2xl">
              {group.links.map((link) => <Link key={link.href} href={link.href} className="block rounded px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white">{link.label}</Link>)}
            </div>
          </details>
        );
      })}
    </nav>
  );
}
