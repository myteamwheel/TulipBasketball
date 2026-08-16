import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { isAuthenticated, authRequired } from "@/lib/auth";
import RefreshButton from "@/components/RefreshButton";
import AppNav from "@/components/AppNav";

// Every page under this layout reads live DB/session state; never
// statically prerender so a rebuild isn't required to see fresh data.
export const dynamic = "force-dynamic";


export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!(await isAuthenticated())) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/90 shadow-lg shadow-black/10 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="min-w-0 flex items-center gap-6">
            <span className="truncate text-sm font-semibold tracking-tight text-neutral-100">
              <span className="sm:hidden">Dynasty Boys</span><span className="hidden sm:inline">Dynasty Boys <span className="text-emerald-500">·</span> Market Terminal</span>
            </span>
            <AppNav variant="desktop" />
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
        <AppNav variant="mobile" />
      </header>
      <main className="page-enter mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-4 sm:py-6">{children}</main>
    </div>
  );
}
