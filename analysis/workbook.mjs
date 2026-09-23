import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const directory = process.argv[2];
const data = JSON.parse(gunzipSync(await fs.readFile(path.join(directory, 'tables.json.gz'))));
const workbook = new ExcelJS.Workbook();
workbook.creator = 'Dynasty Bois Dashboard';
workbook.created = new Date(data.generatedAt);
const readme = workbook.addWorksheet('README');
readme.columns = [{ width: 32 }, { width: 95 }];
readme.addRows([
  ['Dynasty Bois audit', 'Orlando Oswalds and all league teams'],
  ['Generated', data.generatedAt],
  ['Fresh source fetch', data.freshInputs],
  ['Comparison', data.comparedWith ?? 'First snapshot'],
  ['Sources', 'Sleeper league histories; FantasyCalc current values; DynastyProcess value history; nflverse football data.'],
  ['College profile baseline', data.collegeBaseline],
  ['Method', 'Original portfolio analysis. Trade results include context and subsequent lineup production; draft picks are valued by slot.'],
  ['Missing values', 'Blank means unavailable. Values from different providers use different scales.'],
  ['Table definitions', 'Descriptions retain the source audit’s terminology. Table contents and row counts are rebuilt on every pass.'],
]);
const used = new Set(['README']);
for (const table of data.tables) {
  let name = table.name.slice(0, 31), n = 2;
  while (used.has(name)) name = `${table.name.slice(0, 27)}_${n++}`;
  used.add(name);
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  const keys = [...new Set(table.rows.flatMap(Object.keys))];
  sheet.columns = keys.map(key => ({ header: key, key, width: Math.min(48, Math.max(12, key.length + 3)) }));
  sheet.addRows(table.rows.map(row => Object.fromEntries(keys.map(key => [key, typeof row[key] === 'object' && row[key] !== null ? JSON.stringify(row[key]) : row[key]]))));
  if (keys.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: table.rows.length + 1, column: keys.length } };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF164E45' } };
  sheet.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(1).height = 32;
}
await workbook.xlsx.writeFile(path.join(directory, 'Dynasty-Bois-Data.xlsx'));
// Reopen the actual download to catch serialization and missing-sheet failures.
const check = new ExcelJS.Workbook();
await check.xlsx.readFile(path.join(directory, 'Dynasty-Bois-Data.xlsx'));
if (check.worksheets.length !== data.tables.length + 1) throw new Error('Workbook sheet validation failed');
