"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Command Center", short: "Team" },
  { href: "/league", label: "League Market", short: "League" },
  { href: "/transactions", label: "Transactions", short: "Trades" },
  { href: "/players", label: "Player Market", short: "Players" },
  { href: "/refresh-history", label: "Data Health", short: "Data" },
  { href: "/settings", label: "Settings", short: "Settings" },
];

function activeFor(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppNav({ variant }: { variant: "desktop" | "mobile" }) {
  const pathname = usePathname();
  if (variant === "desktop") {
    return (
      <nav className="hidden gap-1 md:flex">
        {NAV.map((item) => {
          const active = activeFor(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                active
                  ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/20"
                  : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto border-t border-neutral-900 px-2 py-1.5 md:hidden">
      {NAV.map((item) => {
        const active = activeFor(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] ${
              active ? "bg-emerald-500/10 text-emerald-300" : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
            }`}
          >
            {item.short}
          </Link>
        );
      })}
    </nav>
  );
}
