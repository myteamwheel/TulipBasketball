import Link from "next/link";
import type { getFullAudit } from "@/lib/fullAudit";
import { formatDateTimeEastern } from "@/lib/format";

const SECTIONS = [
  { title: "League snapshot", description: "The current league-wide roster, value, and draft-pick picture.", tables: ["audit_core_per_league", "current_brett_players", "future_picks"] },
  { title: "Orlando Oswalds trade review", description: "Your strongest and weakest historical Dynasty Bois trades, with present-day outcomes.", tables: ["playbook_bois_best", "playbook_bois_worst", "history_best_trades", "history_worst_trades"] },
  { title: "Strategy and recommendations", description: "Decision research and descriptive findings drawn from the complete trade history.", tables: ["recommendations", "playbook_bois_month", "playbook_bois_phase", "playbook_formula_bois"] },
  { title: "League history and trends", description: "Manager history, activity, results, and long-term league patterns.", tables: ["trends_manager_season", "history_activity_by_league", "history_trade_mgr_rank", "history_partners"] },
] as const;

const REPORT_ORDER = ["Dynasty Audit", "Ownership History", "Combine Profile", "Trade Ledger", "Trade Playbook", "Strategy Timeline", "Reference"] as const;
const REPORT_DESCRIPTIONS: Record<string, string> = {
  "Dynasty Audit": "Current rosters, team capital, future picks, league comparisons, and audit findings.",
  "Ownership History": "Roster tenure, acquisition patterns, player movement, draft history, and historical outcomes.",
  "Combine Profile": "Athletic and draft-profile context for current and historical players.",
  "Trade Ledger": "Complete league trade history, trade assets, current values, and partner analysis.",
  "Trade Playbook": "Trade-pattern findings, recommendations, and Orlando Oswalds-specific playbook evidence.",
  "Strategy Timeline": "Season results, weekly history, and long-term league trends.",
  Reference: "Supporting dictionary and source metadata used by the audit.",
};

const TABLE_TITLES: Record<string, string> = { current_brett_players: "Orlando Oswalds roster", future_picks: "Future rookie picks", audit_core_per_league: "League overview", playbook_bois_best: "Best Dynasty Bois trades", playbook_bois_worst: "Costliest Dynasty Bois trades", history_best_trades: "Best trades in league history", history_worst_trades: "Costliest trades in league history", recommendations: "Strategy recommendations", trends_manager_season: "Manager season trends", history_activity_by_league: "League activity by season", history_trade_mgr_rank: "Manager trade rankings", history_partners: "Trade partners", playbook_bois_month: "Trade outcomes by month", playbook_bois_phase: "Trade outcomes by career phase", playbook_formula_bois: "Trade-pattern model", ledger_brett_partners: "Orlando Oswalds trade partners", ledger_brett_rank_by_league: "Orlando Oswalds standing by season", brett_trades_ranked: "Orlando Oswalds trades ranked", playbook_brett_best: "Orlando Oswalds best trades", playbook_brett_worst: "Orlando Oswalds costliest trades" };

function dynastyRow(tableName: string, row?: Record<string, unknown>) {
  if (/bois|brett/i.test(tableName)) return true;
  return Object.values(row ?? {}).some((value) => /dynasty bois/i.test(String(value)));
}
function displayText(value: unknown, tableName = "", row?: Record<string, unknown>) {
  let text = String(value).replaceAll(/jeffsharpington/gi, "Jeff");
  if (dynastyRow(tableName, row)) text = text.replaceAll(/BrettTulip/gi, "Orlando Oswalds").replaceAll(/Brett's/gi, "Orlando Oswalds'").replaceAll(/\bBrett\b/gi, "Orlando Oswalds");
  return text;
}
function humanColumn(value: string) { return value.replaceAll("_", " ").replace(/\b(fcs|nfl|qb|rb|wr|te)\b/gi, (match) => match.toUpperCase()).replace(/\byr(\d+)\b/gi, "Year $1").replace(/\bn rosters\b/i, "Roster count").replace(/\brank high\b/i, "Best rank").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function displayValue(value: unknown, column: string, tableName: string, row: Record<string, unknown>) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (/percent|pct|rate|ratio|share|probability/i.test(column) && Math.abs(value) <= 1) return `${(value * 100).toFixed(1)}%`;
    return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return displayText(typeof value === "object" ? JSON.stringify(value) : value, tableName, row);
}
function tableTitle(name: string) { return TABLE_TITLES[name] ?? humanColumn(name); }
type AuditTable = Awaited<ReturnType<typeof getFullAudit>>["data"]["tables"][number];

function NativeTable({ table, expanded = false }: { table: AuditTable; expanded?: boolean }) {
  const columns = [...new Set(table.rows.flatMap((row) => Object.keys(row)))], visible = table.rows;
  return <section className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900"><div className="flex flex-wrap items-start justify-between gap-2 border-b border-neutral-800 px-4 py-3"><div><h2 className="text-base font-semibold text-neutral-100">{tableTitle(table.name)}</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">{displayText(table.description || `${table.rows.length.toLocaleString()} rows from the validated audit.`, table.name)}</p></div><Link href={`/audit/research?table=${encodeURIComponent(table.name)}`} className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300">Search table</Link></div><div className="max-h-[42rem] max-w-full overflow-auto"><table className="w-full min-w-[720px] text-xs"><thead className="sticky top-0 bg-neutral-950"><tr>{columns.map((column) => <th key={column} className="whitespace-nowrap border-b border-neutral-800 px-3 py-2 text-left font-medium text-neutral-500">{humanColumn(column)}</th>)}</tr></thead><tbody>{visible.map((row, index) => <tr key={index} className="border-b border-neutral-800/80 last:border-0">{columns.map((column) => <td key={column} className="max-w-sm px-3 py-2 align-top text-neutral-300">{displayValue(row[column], column, table.name, row)}</td>)}</tr>)}</tbody></table></div></section>;
}

export default function FullAuditReport({ audit, selectedName }: { audit: Awaited<ReturnType<typeof getFullAudit>>; selectedName?: string }) {
  const selected = selectedName ? audit.data.tables.find((table) => table.name === selectedName) : null;
  const sections = SECTIONS.map((section) => ({ ...section, tables: section.tables.map((name) => audit.data.tables.find((table) => table.name === name)).filter((table): table is AuditTable => Boolean(table)) })).filter((section) => section.tables.length);
  const grouped = new Set(sections.flatMap((section) => section.tables.map((table) => table.name))), referenceTables = audit.data.tables.filter((table) => !grouped.has(table.name));
  const referenceGroups = REPORT_ORDER.map((report) => ({ report, tables: referenceTables.filter((table) => table.report === report) })).filter((group) => group.tables.length);
  const downloadQuery = (file: string) => `/api/audit/research?${new URLSearchParams({ run: audit.id, file })}`;
  return <main className="min-w-0 space-y-7"><section className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/audit" className="text-xs text-emerald-400">← Live audit overview</Link><h1 className="mt-2 text-2xl font-semibold text-neutral-100">Dynasty Bois Report</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">A structured, live report of the validated Dynasty Bois audit. It follows the report’s league snapshot, Orlando Oswalds review, strategy, and history sections; downloads use this same audit run.</p><p className="mt-2 text-xs text-neutral-500">Generated {formatDateTimeEastern(audit.data.generatedAt)} · all {audit.data.tables.length} audit tables are retained across {REPORT_ORDER.length} report sections · refreshed by the validated 8 a.m. ET research pass.</p></div><div className="flex flex-wrap gap-2"><Link href="/audit/research" className="rounded border border-neutral-700 px-3 py-2 text-sm text-neutral-200">All source tables</Link><a href={downloadQuery("Dynasty-Bois-Data.xlsx")} className="rounded border border-neutral-700 px-3 py-2 text-sm text-neutral-200">Download Excel</a><a href={downloadQuery("Dynasty-Bois-Report.pdf")} className="rounded border border-emerald-800 px-3 py-2 text-sm text-emerald-300">Download PDF</a></div></section>{selected ? <NativeTable table={selected} expanded /> : <>{sections.map((section) => <section key={section.title} className="space-y-3"><div className="border-b border-neutral-800 pb-2"><h2 className="text-lg font-semibold text-neutral-100">{section.title}</h2><p className="mt-1 text-xs text-neutral-500">{section.description}</p></div><div className="space-y-3">{section.tables.map((table) => <NativeTable key={table.name} table={table} />)}</div></section>)}<section className="space-y-4"><div className="border-b border-neutral-800 pb-2"><h2 className="text-lg font-semibold text-neutral-100">Complete audit reference</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">Every remaining source table is grouped by the same report family used by the complete workbook, so the detailed research stays navigable without becoming an unstructured wall of data.</p></div>{referenceGroups.map((group) => <div key={group.report} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"><h3 className="text-sm font-semibold text-neutral-100">{group.report}</h3><p className="mt-1 text-xs leading-5 text-neutral-500">{REPORT_DESCRIPTIONS[group.report] ?? "Supporting research tables."} · {group.tables.length} tables</p><div className="mt-3 flex flex-wrap gap-2">{group.tables.map((table) => <Link key={table.name} href={`/audit/report?table=${encodeURIComponent(table.name)}`} className="rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-400 hover:text-neutral-100">{tableTitle(table.name)}</Link>)}</div></div>)}</section></>}</main>;
}
