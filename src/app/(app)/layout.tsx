import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { isAuthenticated, authRequired } from "@/lib/auth";
import { ensureOrlandoHistoryBackfill } from "@/lib/orlandoHistoryBackfill";
import RefreshButton from "@/components/RefreshButton";
import TopNav from "@/components/TopNav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!(await isAuthenticated())) redirect("/login");

  await ensureOrlandoHistoryBackfill();

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-30 w-full border-b border-neutral-800/90 bg-neutral-950/95 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-4">
          <div className="flex min-w-0 items-center justify-between gap-2 py-2.5">
            <div className="min-w-0 truncate text-sm font-semibold tracking-tight text-neutral-100">
              <span>Dynasty Boys</span>
              <span className="hidden sm:inline"> <span className="text-emerald-500">·</span> Market Terminal</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <RefreshButton />
              {authRequired() ? (
                <form action="/api/auth/logout" method="post" className="hidden sm:block">
                  <button className="rounded-md px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300">Sign out</button>
                </form>
              ) : null}
            </div>
          </div>
          <div className="border-t border-neutral-900/90">
            <TopNav />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-7xl px-3 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-6">
        {children}
      </main>
    </div>
  );
}
