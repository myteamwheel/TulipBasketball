"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "My Team" },
  { href: "/forecast", label: "Predictions" },
  { href: "/league", label: "League" },
  { href: "/trade-finder", label: "Trade Lab" },
  { href: "/waivers", label: "Waivers" },
  { href: "/transactions", label: "Transactions" },
  { href: "/players", label: "Players" },
  { href: "/refresh-history", label: "Refreshes", utility: true },
  { href: "/settings", label: "Data Health", utility: true },
];
export default function TopNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="no-scrollbar flex w-full flex-nowrap items-center gap-0.5 overflow-x-auto py-1"
    >
      {links.map((link) => {
        const active =
          link.href === "/"
            ? pathname === link.href
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-md px-2 py-1.5 text-[10px] font-medium transition sm:px-2.5 sm:text-[11px] ${active ? "bg-neutral-800 text-neutral-100" : link.utility ? "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200" : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
