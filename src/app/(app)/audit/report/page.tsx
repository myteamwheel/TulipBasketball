import Link from "next/link";
import { getFullAudit } from "@/lib/fullAudit";
import { formatDateTimeEastern } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AuditReportPage() {
  const audit = await getFullAudit();
  const reportUrl = `/api/audit/research?${new URLSearchParams({
    run: audit.id,
    file: "Dynasty-Bois-Report.pdf",
    view: "inline",
  })}`;

  return (
    <main className="min-w-0 space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/audit" className="text-xs text-emerald-400">← Live audit overview</Link>
          <h1 className="mt-2 text-2xl font-semibold text-neutral-100">Full Dynasty Bois Report</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
            The complete formatted report for Orlando Oswalds and the league. This is the
            same current report available as a PDF download, displayed directly in the site.
            It is replaced only by a validated daily full-audit publication.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Generated {formatDateTimeEastern(audit.data.generatedAt)} · {audit.data.tables.length} research tables
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/audit/research" className="rounded border border-neutral-700 px-3 py-2 text-sm text-neutral-200">Browse tables</Link>
          <a href={`/api/audit/research?${new URLSearchParams({ run: audit.id, file: "Dynasty-Bois-Report.pdf" })}`} className="rounded border border-emerald-800 px-3 py-2 text-sm text-emerald-300">Download PDF</a>
        </div>
      </section>
      <section className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
        <iframe
          title="Current Dynasty Bois full report"
          src={reportUrl}
          className="h-[calc(100vh-15rem)] min-h-[720px] w-full bg-white"
        />
      </section>
    </main>
  );
}
