import { getFullAudit } from "@/lib/fullAudit";
import FullAuditReport from "@/components/FullAuditReport";
import { getLatestAuditRefresh } from "@/lib/audit";
import { formatDateTimeEastern } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AuditReportPage({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  const query = await searchParams;
  const [audit, latestRefresh] = await Promise.all([
    getFullAudit(),
    getLatestAuditRefresh(),
  ]);
  const refreshedAt = latestRefresh?.finishedAt ?? latestRefresh?.startedAt ?? null;
  const refreshIsNewer = refreshedAt
    ? refreshedAt.getTime() > new Date(audit.data.generatedAt).getTime()
    : false;
  const refreshCanDriveLiveData = latestRefresh?.status === "SUCCESS";
  return (
    <div className="min-w-0 space-y-4">
      {latestRefresh ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[11px] leading-5 text-neutral-400">
          <span className="font-semibold text-neutral-200">Freshness:</span>{" "}
          this long-form research bundle was generated {formatDateTimeEastern(audit.data.generatedAt)}. The newest dashboard refresh is {latestRefresh.status.toLowerCase().replaceAll("_", " ")} from {formatDateTimeEastern(refreshedAt?.toISOString())}.{" "}
          {refreshIsNewer
            ? refreshCanDriveLiveData
              ? "Live roster, market, projections, and Team Outlook already use that newer successful run; the research bundle remains visibly dated until a new full research publication is generated."
              : "This attempt did not publish a new validated research bundle. Individual sources may have updated; this report remains dated to its verified publication."
            : "This bundle reflects the newest recorded dashboard refresh."}
        </div>
      ) : null}
      <FullAuditReport audit={audit} selectedName={query.table} />
    </div>
  );
}
