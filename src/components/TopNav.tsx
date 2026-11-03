"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import MotionToggle from "@/components/MotionToggle";

type NavGroup = {
  label: string;
  href: string;
  links?: Array<{ href: string; label: string; marksActive?: boolean }>;
};

// Keep the roster and trade review first; diagnostics belong at the end.
const groups: NavGroup[] = [
  { label: "My Team", href: "/" },
  { label: "Trade Review", href: "/trade-review" },
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
  const mobilePrimaryActive = ["/", "/trade-review", "/team-outlook", "/trade-finder"].some(
    href => href === "/" ? pathname === "/" : pathname.startsWith(href),
  );
  const mobileMoreOpen = openMenu?.label === "More" && openMenu.pathname === pathname;

  useEffect(() => {
    const update = () => {
      const compact = window.scrollY > 160;
      document.documentElement.dataset.compactNav = compact ? 'true' : 'false';
      const header = navRef.current?.closest('header');
      if (header) document.documentElement.style.setProperty('--dashboard-header-height', header.getBoundingClientRect().height + 'px');
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    if (navRef.current?.closest('header')) observer.observe(navRef.current.closest('header')!);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); observer.disconnect(); };
  }, []);

  // Start a new section at its heading, even when the previous page was long.
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

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
      <div className="hidden gap-1 overflow-x-auto pb-1 lg:flex">
        {groups.map((group) => {
          const active = isActive(pathname, group);
          const itemClass = `inline-flex min-h-11 items-center justify-center px-3 text-xs font-medium transition-colors ${
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
                aria-current={pathname === group.href ? "page" : undefined}
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
                aria-current={pathname === group.href ? "page" : undefined}
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
      <div className="grid grid-cols-5 gap-1 lg:hidden">
        {[
          { label: "Team", href: "/" },
          { label: "Review", href: "/trade-review" },
          { label: "Outlook", href: "/team-outlook" },
          { label: "Trade Lab", href: "/trade-finder" },
        ].map(item => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} onClick={() => setOpenMenu(null)} className={"flex min-h-11 items-center justify-center rounded-md px-1 text-center text-xs font-semibold " + (active ? "bg-emerald-700 text-white" : "text-neutral-500")}>{item.label}</Link>;
        })}
        <button type="button" aria-label="More navigation" aria-expanded={mobileMoreOpen} aria-controls="mobile-more-menu" onClick={() => setOpenMenu(mobileMoreOpen ? null : { label: "More", pathname })} className={"min-h-11 rounded-md px-1 text-xs font-semibold " + (mobileMoreOpen || !mobilePrimaryActive ? "bg-emerald-700 text-white" : "text-neutral-500")}>More ▾</button>
      </div>
      {mobileMoreOpen ? <div id="mobile-more-menu" className="absolute inset-x-0 top-full z-50 grid max-h-[70vh] grid-cols-2 gap-1 overflow-y-auto rounded-b-xl border border-neutral-700 bg-neutral-900 p-2 shadow-xl lg:hidden">{groups.flatMap(group => [{ href: group.href, label: group.label }, ...(group.links ?? [])]).filter(item => !["/", "/trade-review", "/team-outlook", "/trade-finder"].includes(item.href)).map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} onClick={() => setOpenMenu(null)} className={`flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-neutral-800 ${pathname === item.href ? "bg-emerald-950 text-emerald-300" : "text-neutral-200"}`}>{item.label}</Link>)}<div className="col-span-2 border-t border-neutral-800 pt-2"><MotionToggle /></div></div> : null}
      {openGroup?.links?.length ? (
        <div
          id={openMenuId}
          role="navigation"
          aria-label={`${openGroup.label} menu`}
          className="absolute inset-x-0 top-full z-50 mt-1 flex flex-wrap gap-1 rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl"
        >
          {openGroup.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
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
