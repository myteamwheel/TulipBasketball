import Link from "next/link";
import { getFullAudit } from "@/lib/fullAudit";
import AuditAutoRefresh from "@/components/AuditAutoRefresh";
import { formatDateTimeEastern } from "@/lib/format";

export const dynamic = "force-dynamic";
const displayText = (value: unknown) => String(value).replaceAll(/BrettTulip/gi, "Orlando Oswalds").replaceAll(/Brett's/gi, "Orlando Oswalds'").replaceAll(/\bBrett\b/gi, "Orlando Oswalds").replaceAll(/jeffsharpington/gi, "Jeff");
export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ table?: string; q?: string; page?: string }> }) {
  const query = await searchParams;
  const audit = await getFullAudit();
  const data = audit.data;
  const table = data.tables.find(row => row.name === query.table) ?? data.tables.find(row => row.name === "current_brett_players") ?? data.tables[0];
  const search = (query.q ?? "").slice(0, 200);
  const rows = search ? table.rows.filter(row => Object.values(row).some(value => String(value ?? "").toLowerCase().includes(search.toLowerCase()))) : table.rows;
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const requestedPage = Number(query.page);
  const page = Number.isInteger(requestedPage) ? Math.min(pages, Math.max(1, requestedPage)) : 1;
  const columns = [...new Set(table.rows.flatMap(row => Object.keys(row)))];
  const href = (number: number) => `/audit/research?${new URLSearchParams({ table: table.name, q: search, page: String(number) })}`;
  const downloads = (name: string) => `/api/audit/research?${new URLSearchParams({ run: audit.id, file: name })}`;
  return <main className="space-y-6 min-w-0">
    <AuditAutoRefresh enabled />
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><Link href="/audit" className="text-xs text-emerald-400">← Audit overview and trends</Link><h1 className="mt-2 text-2xl font-semibold">Full Dynasty Bois research</h1><p className="mt-2 text-sm text-neutral-400">Orlando Oswalds and the league · {data.tables.length} data tables · {formatDateTimeEastern(data.generatedAt)}</p></div>
      <div className="flex gap-2"><a className="rounded border border-emerald-800 px-3 py-2 text-sm text-emerald-300" href={downloads("Dynasty-Bois-Data.xlsx")}>Full Excel</a><a className="rounded border border-neutral-700 px-3 py-2 text-sm" href={downloads("Dynasty-Bois-Report.pdf")}>Full PDF</a></div>
    </div>
    {!audit.published && <p className="rounded border border-amber-800 bg-amber-950/20 p-4 text-sm text-amber-200">Original September 23 audit. A successful automated full rebuild has not been published yet. These historical tables are available to browse while that connection is being completed.</p>}
    {audit.published && <p className="text-sm text-neutral-400">Rebuilt from Sleeper, FantasyCalc, DynastyProcess and nflverse. The page checks for new results automatically. College profiles retain the {data.collegeBaseline} reference baseline.</p>}
    <details className="rounded border border-neutral-800 p-4"><summary className="cursor-pointer text-sm">Changes from the previous full audit ({data.changes.length} tables)</summary><p className="mt-3 text-xs text-neutral-500">{data.comparedWith ? `Compared with ${formatDateTimeEastern(data.comparedWith)}. Updated rows include recalculated values as well as new activity.` : "This is the baseline; comparisons start with the next completed pass."}</p><ul className="mt-3 space-y-1 text-xs text-neutral-300">{data.changes.map(row => <li key={row.table}>{row.table}: {row.currentRows} rows; {row.addedOrChanged} added or changed, {row.removedOrChanged} removed or changed.</li>)}</ul></details>
    <form className="flex flex-wrap gap-3" action="/audit/research"><label className="text-xs text-neutral-400">Audit table<select name="table" defaultValue={table.name} className="mt-1 block max-w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-white">{data.tables.map(row => <option key={row.name} value={row.name}>{displayText(row.report)} / {displayText(row.name)} ({row.rows.length})</option>)}</select></label><label className="text-xs text-neutral-400">Search this table<input name="q" defaultValue={search} maxLength={200} className="mt-1 block rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-white" /></label><button className="self-end rounded bg-emerald-900 px-4 py-2 text-sm">Show results</button></form>
    <div><h2 className="text-lg font-medium">{displayText(table.name.replaceAll("_", " "))}</h2><p className="mt-1 text-xs text-neutral-500">{rows.length.toLocaleString()} matching rows · page {page} of {pages}. Blank cells mean unavailable.</p></div>
    <div className="max-w-full overflow-auto rounded border border-neutral-800"><table className="w-full border-collapse text-xs"><thead className="bg-neutral-900"><tr>{columns.map(column => <th key={column} className="whitespace-nowrap border-b border-neutral-700 px-3 py-3 text-left text-neutral-300">{displayText(column.replaceAll("_", " "))}</th>)}</tr></thead><tbody>{rows.slice((page - 1) * 50, page * 50).map((row, index) => <tr key={index} className="odd:bg-neutral-950 even:bg-neutral-900/40">{columns.map(column => <td key={column} className="max-w-lg border-b border-neutral-800 px-3 py-2 align-top text-neutral-400">{row[column] === null || row[column] === undefined ? "—" : displayText(typeof row[column] === "object" ? JSON.stringify(row[column]) : row[column])}</td>)}</tr>)}</tbody></table></div>
    <nav className="flex justify-between text-sm"><Link aria-disabled={page === 1} href={href(Math.max(1, page - 1))}>Previous</Link><Link aria-disabled={page === pages} href={href(Math.min(pages, page + 1))}>Next</Link></nav>
  </main>;
}
