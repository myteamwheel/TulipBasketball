"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type NavGroup = {
  label: string;
  href: string;
  links?: Array<{ href: string; label: string; marksActive?: boolean }>;
};

// This follows the order most useful during a normal league week: your roster,
// the league race, player decisions, then possible deals and league activity.
const groups: NavGroup[] = [
  { label: "My Team", href: "/" },
  {
    label: "Team Outlook",
    href: "/team-outlook",
    links: [
      { href: "/team-outlook/trade-impact", label: "Trade impact" },
      // This is a useful shortcut from Team Outlook, while Trade Lab remains
      // the owner of the destination and its active navigation state.
      { href: "/trade-finder", label: "Trade targets", marksActive: false },
    ],
  },
  {
    label: "Predictions",
    href: "/forecast",
    links: [{ href: "/projections", label: "Projected points" }],
  },
  {
    label: "Trade Lab",
    href: "/trade-finder",
    links: [{ href: "/waivers", label: "Waivers" }],
  },
  {
    label: "League",
    href: "/league",
    links: [
      { href: "/transactions", label: "Transactions" },
      { href: "/players", label: "Players" },
    ],
  },
  {
    label: "Data",
    href: "/audit",
    links: [
      { href: "/audit/report", label: "Full report" },
      { href: "/refresh-history", label: "Refresh history" },
      { href: "/settings", label: "Data health" },
      { href: "/data-export", label: "Export" },
    ],
  },
];

function isActive(pathname: string, group: NavGroup) {
  const links = [
    group.href,
    ...(group.links
      ?.filter((link) => link.marksActive !== false)
      .map((link) => link.href) ?? []),
  ];
  return links.some((href) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href),
  );
}
export default function TopNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<{
    label: string;
    pathname: string;
    } | null>(null);
  const openGroup =
    openMenu?.pathname === pathname
      ? groups.find((group) => group.label === openMenu.label)
      : undefined;
  const openMenuId = openGroup
    ? `nav-menu-${openGroup.label.toLowerCase().replaceAll(" ", "-")}`
    : undefined;

  // An outside click or Escape clears the menu. The state also records the
  // pathname it was opened on, so a route change hides it without a second
  // state update during render.
  useEffect(() => {
    const closeOnOutsidePress = (event: MouseEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      className="relative py-1.5"
    >
      <div className="flex flex-wrap gap-1">
        {groups.map((group) => {
          const active = isActive(pathname, group);
          const itemClass = `inline-flex min-h-9 items-center justify-center px-3 text-xs font-medium transition-colors ${
            active
              ? "bg-emerald-700 text-white shadow-sm"
              : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
          }`;
          const menuId = `nav-menu-${group.label
            .toLowerCase()
            .replaceAll(" ", "-")}`;

          if (!group.links?.length) {
            return (
              <Link
                key={group.label}
                href={group.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpenMenu(null)}
                className={`shrink-0 rounded-md ${itemClass}`}
              >
                {group.label}
              </Link>
            );
          }

          const isOpen = openGroup?.label === group.label;
          return (
            <div key={group.label} className="flex shrink-0">
              <Link
                href={group.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpenMenu(null)}
                className={`rounded-l-md ${itemClass}`}
              >
                {group.label}
              </Link>
              <button
                type="button"
                aria-label={`Open ${group.label} menu`}
                aria-expanded={isOpen}
                aria-controls={menuId}
                onClick={() =>
                  setOpenMenu(isOpen ? null : { label: group.label, pathname })
                }
                className={`rounded-r-md border-l border-neutral-700 px-2 text-[10px] ${itemClass}`}
              >
                <span aria-hidden="true">▾</span>
              </button>
            </div>
          );
        })}
      </div>
      {openGroup?.links?.length ? (
        <div
          id={openMenuId}
          role="menu"
          aria-label={`${openGroup.label} menu`}
          className="absolute inset-x-0 top-full z-50 mt-1 flex flex-wrap gap-1 rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl"
        >
          {openGroup.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              role="menuitem"
              onClick={() => setOpenMenu(null)}
              className="rounded-md px-3 py-2 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
