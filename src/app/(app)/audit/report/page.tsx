import { getFullAudit } from "@/lib/fullAudit";
import FullAuditReport from "@/components/FullAuditReport";

export const dynamic = "force-dynamic";

export default async function AuditReportPage({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  const query = await searchParams;
  const audit = await getFullAudit();
  return <FullAuditReport audit={audit} selectedName={query.table} />;
}
