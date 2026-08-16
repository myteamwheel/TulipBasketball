"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "My Team" },
  { href: "/league", label: "League" },
  { href: "/trade-finder", label: "Trade Lab" },
  { href: "/transactions", label: "Transactions" },
  { href: "/players", label: "Players" },
  { href: "/refresh-history", label: "Refreshes" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto py-1.5">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
              active
                ? "bg-neutral-800 text-neutral-50"
                : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
