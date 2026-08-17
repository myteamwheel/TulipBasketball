import type { ReactNode } from "react";
import TopNav from "@/components/TopNav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-30 w-full border-b border-neutral-800/90 bg-neutral-950/95 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-4">
          <div className="flex min-w-0 items-center justify-between gap-2 py-2.5">
            <div className="min-w-0 truncate text-sm font-semibold tracking-tight text-neutral-100">
              <span>Dynasty Boys</span>
              <span className="hidden sm:inline"> <span className="text-emerald-500">·</span> Market Terminal</span>
            </div>
            <div className="shrink-0 text-[9px] text-neutral-600 sm:text-[10px]">Read-only · auto sync ~8 a.m. ET</div>
          </div>
          <div className="border-t border-neutral-900/90"><TopNav /></div>
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-7xl px-3 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-6">{children}</main>
    </div>
  );
}
