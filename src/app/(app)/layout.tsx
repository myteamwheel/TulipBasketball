import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isAuthenticated, authRequired } from "@/lib/auth";
import { ensurePatch14Schema } from "@/lib/prisma";
import RefreshButton from "@/components/RefreshButton";

// Every page under this layout reads live DB/session state; never
// statically prerender so a rebuild isn't required to see fresh data.
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", label: "My Team" },
  { href: "/league", label: "League Market" },
  { href: "/transactions", label: "Transactions" },
  { href: "/players", label: "Players" },
  { href: "/refresh-history", label: "Refresh History" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  await ensurePatch14Schema();
  if (!(await isAuthenticated())) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight text-neutral-100">
              Dynasty Boys <span className="text-emerald-500">·</span> Market Terminal
            </span>
            <nav className="hidden gap-1 md:flex">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-sm text-neutral-400 transition hover:bg-neutral-900 hover:text-neutral-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <RefreshButton />
            {authRequired() && (
              <form action="/api/auth/logout" method="post">
                <button className="text-xs text-neutral-500 hover:text-neutral-300">Sign out</button>
              </form>
            )}
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-neutral-900 px-4 py-1.5 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-md px-3 py-1 text-xs text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
