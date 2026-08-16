import { prisma } from "@/lib/prisma";
import { runScheduledRefresh } from "@/lib/refresh";
import { DISPLAY_TIMEZONE } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) return request.headers.get("authorization") === `Bearer ${secret}`;
  return (request.headers.get("user-agent") ?? "").includes("vercel-cron/1.0");
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const local = localParts(now);
  // Vercel cron expressions are UTC. We invoke at both 12:00 and 13:00 UTC,
  // then run only when America/New_York is actually in the 8 AM hour. This
  // preserves 8 AM through EDT/EST without manual DST edits.
  if (local.hour !== 8) return Response.json({ ok: true, skipped: true, reason: "DST guard", local });

  const recent = await prisma.refreshRun.findMany({
    where: { requestedSources: { contains: "scheduled:8am-eastern" } },
    orderBy: { startedAt: "desc" }, take: 4,
    select: { id: true, startedAt: true, status: true },
  });
  const alreadyRan = recent.find((r) => localParts(r.startedAt).dateKey === local.dateKey);
  if (alreadyRan) return Response.json({ ok: true, skipped: true, reason: "already ran today", runId: alreadyRan.id, status: alreadyRan.status });

  try {
    const run = await runScheduledRefresh();
    return Response.json({ ok: true, scheduledFor: "8:00 AM America/New_York", run });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // If a user-triggered refresh is already running at 8 AM, the daily market
    // snapshot is effectively being collected, so treat that as a safe skip.
    if (message.includes("already in progress")) return Response.json({ ok: true, skipped: true, reason: message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
