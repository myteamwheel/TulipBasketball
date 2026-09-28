import Link from "next/link";
import { getFullAudit } from "@/lib/fullAudit";
import AuditAutoRefresh from "@/components/AuditAutoRefresh";
import { formatDateTimeEastern } from "@/lib/format";

export const dynamic = "force-dynamic";

const TABLE_TITLES: Record<string, string> = {
  current_brett_players: "Orlando Oswalds roster",
  ledger_brett_partners: "Orlando Oswalds trade partners",
  ledger_brett_rank_by_league: "Orlando Oswalds standing by season",
  brett_trades_ranked: "Orlando Oswalds trades ranked",
  playbook_brett_best: "Orlando Oswalds best trades",
  playbook_brett_worst: "Orlando Oswalds costliest trades",
};

const displayText = (value: unknown) =>
  String(value)
    .replaceAll(/Dynasty Bois/gi, "Dynasty Boys")
    .replaceAll(/jeffsharpington/gi, "Jeff")
    .replaceAll(/Brett\s+Tulip['’]s/gi, "Orlando Oswalds'")
    .replaceAll(/Brett\s+Tulip/gi, "Orlando Oswalds")
    .replaceAll(/BrettTulip['’]s/gi, "Orlando Oswalds'")
    .replaceAll(/BrettTulip/gi, "Orlando Oswalds")
    .replaceAll(/Brett['’]s/gi, "Orlando Oswalds'")
    .replaceAll(/Brett's/gi, "Orlando Oswalds'")
    .replaceAll(/\bBrett\b/gi, "Orlando Oswalds");

function tableTitle(table: { name: string }) {
  return TABLE_TITLES[table.name] ?? displayText(table.name.replaceAll("_", " "));
}

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    table?: string;
    report?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const query = await searchParams;
  const audit = await getFullAudit();
  const data = audit.data;
  const reports = [...new Map(
    data.tables.map((table) => [table.report, {
      name: table.report,
      tables: data.tables.filter((candidate) => candidate.report === table.report),
    }]),
  ).values()];
  const table = query.table
    ? data.tables.find((candidate) => candidate.name === query.table)
    : undefined;
  const selectedReport = table?.report ?? reports.find((report) => report.name === query.report)?.name ?? null;
  const report = selectedReport
    ? reports.find((candidate) => candidate.name === selectedReport)
    : undefined;
  const search = (query.q ?? "").slice(0, 200);
  const rows = table
    ? search
      ? table.rows.filter((row) =>
          Object.values(row).some((value) =>
            String(value ?? "").toLowerCase().includes(search.toLowerCase()),
          ),
        )
      : table.rows
    : [];
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const requestedPage = Number(query.page);
  const page = Number.isInteger(requestedPage)
    ? Math.min(pages, Math.max(1, requestedPage))
    : 1;
  const columns = table
    ? [...new Set(table.rows.flatMap((row) => Object.keys(row)))]
    : [];
  const tableHref = (selected: { name: string; report: string }, params?: { q?: string; page?: number }) =>
    `/audit/research?${new URLSearchParams({
      report: selected.report,
      table: selected.name,
      ...(params?.q ? { q: params.q } : {}),
      ...(params?.page && params.page > 1 ? { page: String(params.page) } : {}),
    })}`;
  const reportHref = (reportName: string) =>
    `/audit/research?${new URLSearchParams({ report: reportName })}`;
  const downloads = (name: string) =>
    `/api/audit/research?${new URLSearchParams({ run: audit.id, file: name })}`;

  return (
    <main className="min-w-0 space-y-6">
      <AuditAutoRefresh enabled />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/audit" className="text-xs text-emerald-400">
            ← Audit overview and trends
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Dynasty Boys research library</h1>
          <p className="mt-2 max-w-3xl text-sm leading-5 text-neutral-400">
            Start with a report area, then open a raw table only when you need
            its underlying rows. Orlando Oswalds and all league references use
            the same saved research bundle.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {data.tables.length} tables · {formatDateTimeEastern(data.generatedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            className="rounded border border-emerald-800 px-3 py-2 text-sm text-emerald-300"
            href={downloads("Dynasty-Bois-Data.xlsx")}
          >
            Full Excel
          </a>
          <a
            className="rounded border border-neutral-700 px-3 py-2 text-sm"
            href={downloads("Dynasty-Bois-Report.pdf")}
          >
            Full PDF
          </a>
        </div>
      </div>

      {!audit.published ? (
        <p className="rounded border border-amber-800 bg-amber-950/20 p-4 text-sm text-amber-200">
          Original September 23 research bundle. It remains available while a
          new validated full-audit publication is prepared.
        </p>
      ) : (
        <p className="text-sm text-neutral-400">
          This publication was rebuilt from its validated source data. Open a
          report area below to inspect its table list.
        </p>
      )}

      <details className="rounded border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-500">
        <summary className="cursor-pointer font-medium text-neutral-300">
          Changes from the previous research publication ({data.changes.length} tables)
        </summary>
        <p className="mt-2 leading-5">
          {data.comparedWith
            ? `Compared with ${formatDateTimeEastern(data.comparedWith)}. These counts include recalculated rows as well as new activity.`
            : "This is the baseline publication; comparisons begin with the next completed research pass."}
        </p>
        {data.changes.length ? (
          <ul className="mt-2 space-y-1">
            {data.changes.slice(0, 12).map((change) => (
              <li key={change.table}>
                {tableTitle({ name: change.table })}: {change.currentRows.toLocaleString()} rows; {change.addedOrChanged.toLocaleString()} added or changed, {change.removedOrChanged.toLocaleString()} removed or changed.
              </li>
            ))}
          </ul>
        ) : null}
      </details>

      {!table && !report ? (
        <section>
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-neutral-100">Choose a research area</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Each area groups related findings so the raw-data index does not
              overwhelm the audit overview.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((item) => {
              const rowCount = item.tables.reduce((sum, candidate) => sum + candidate.rows.length, 0);
              return (
                <Link
                  key={item.name}
                  href={reportHref(item.name)}
                  className="group rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition hover:border-emerald-800 hover:bg-emerald-950/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-neutral-100 group-hover:text-emerald-300">
                      {displayText(item.name)}
                    </h3>
                    <span className="rounded-full bg-neutral-950 px-2 py-1 text-[10px] text-neutral-500">
                      {item.tables.length} tables
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-xs leading-5 text-neutral-500">
                    {displayText(item.tables[0]?.description ?? "")}
                  </p>
                  <div className="mt-3 text-[11px] text-neutral-400">
                    {rowCount.toLocaleString()} source rows · Browse area →
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {!table && report ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Link href="/audit/research" className="text-xs text-emerald-400">
                ← All research areas
              </Link>
              <h2 className="mt-2 text-xl font-semibold text-neutral-100">
                {displayText(report.name)}
              </h2>
              <p className="mt-1 text-xs text-neutral-500">
                Pick one focused table when you need its raw rows and columns.
              </p>
            </div>
            <span className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-500">
              {report.tables.length} tables
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {report.tables.map((candidate) => (
              <Link
                key={candidate.name}
                href={tableHref(candidate)}
                className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 transition hover:border-emerald-800 hover:bg-emerald-950/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-medium text-neutral-100">
                    {tableTitle(candidate)}
                  </div>
                  <span className="shrink-0 text-[10px] text-neutral-500">
                    {candidate.rows.length.toLocaleString()} rows
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  {displayText(candidate.description)}
                </p>
                <div className="mt-2 text-[11px] text-emerald-400">Open raw table →</div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {table ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Link href={reportHref(table.report)} className="text-xs text-emerald-400">
                ← {displayText(table.report)} tables
              </Link>
              <h2 className="mt-2 text-xl font-semibold text-neutral-100">
                {tableTitle(table)}
              </h2>
              <p className="mt-1 max-w-4xl text-xs leading-5 text-neutral-500">
                {displayText(table.description)}
              </p>
            </div>
            <Link
              href="/audit/research"
              className="rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300"
            >
              Research overview
            </Link>
          </div>

          <form className="flex flex-wrap items-end gap-3" action="/audit/research">
            <input type="hidden" name="report" value={table.report} />
            <label className="text-xs text-neutral-400">
              Raw table
              <select
                name="table"
                defaultValue={table.name}
                className="mt-1 block max-w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-white"
              >
                {data.tables.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {displayText(candidate.report)} / {tableTitle(candidate)} ({candidate.rows.length})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-neutral-400">
              Search this table
              <input
                name="q"
                defaultValue={search}
                maxLength={200}
                className="mt-1 block rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-white"
              />
            </label>
            <button className="rounded bg-emerald-900 px-4 py-2 text-sm text-white">
              Show raw rows
            </button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <span>
              {rows.length.toLocaleString()} matching rows · page {page} of {pages}
            </span>
            <span>Blank cells mean unavailable.</span>
          </div>
          <div className="max-w-full overflow-auto rounded border border-neutral-800">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-neutral-900">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column}
                      className="whitespace-nowrap border-b border-neutral-700 px-3 py-3 text-left text-neutral-300"
                    >
                      {displayText(column.replaceAll("_", " "))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice((page - 1) * 50, page * 50).map((row, index) => (
                  <tr key={index} className="odd:bg-neutral-950 even:bg-neutral-900/40">
                    {columns.map((column) => (
                      <td
                        key={column}
                        className="max-w-lg border-b border-neutral-800 px-3 py-2 align-top text-neutral-400"
                      >
                        {row[column] === null || row[column] === undefined
                          ? "—"
                          : displayText(
                              typeof row[column] === "object"
                                ? JSON.stringify(row[column])
                                : row[column],
                            )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="flex justify-between text-sm">
            <Link
              aria-disabled={page === 1}
              className={page === 1 ? "pointer-events-none opacity-40" : ""}
              href={tableHref(table, { q: search, page: Math.max(1, page - 1) })}
            >
              Previous
            </Link>
            <Link
              aria-disabled={page === pages}
              className={page === pages ? "pointer-events-none opacity-40" : ""}
              href={tableHref(table, { q: search, page: Math.min(pages, page + 1) })}
            >
              Next
            </Link>
          </nav>
        </section>
      ) : null}
    </main>
  );
}
