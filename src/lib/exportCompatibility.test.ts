import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { excelValue } from "./excelCell";

const runtimeRequire = createRequire(import.meta.url);

test("streaming Excel exports preserve data, styles, filters, dates, and exact IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynasty-xlsx-"));
  try {
    const filename = join(directory, "export.xlsx");
    const book = new ExcelJS.stream.xlsx.WorkbookWriter({ filename, useStyles: true, useSharedStrings: false });
    const sheet = book.addWorksheet("Transactions", { views: [{ state: "frozen", ySplit: 2 }] });
    sheet.addRow(["Transaction export"]).commit();
    const header = sheet.addRow(["ID", "Value", "Recorded at", "Payload"]);
    header.font = { bold: true };
    header.commit();
    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 4 } };
    const date = new Date("2026-11-01T12:00:00Z");
    for (let index = 0; index < 200; index++) {
      sheet.addRow([excelValue(BigInt("1312155271526625280") + BigInt(index)), index, date, excelValue("🏈".repeat(20_000))]).commit();
    }
    sheet.commit();
    const second = book.addWorksheet("Summary");
    second.addRow(["Rows", 200]).commit();
    second.commit();
    await book.commit();

    const restored = new ExcelJS.Workbook();
    await restored.xlsx.readFile(filename);
    const transactions = restored.getWorksheet("Transactions")!;
    assert.equal(transactions.rowCount, 202);
    assert.equal(transactions.getCell("A3").value, "1312155271526625280");
    assert.equal(transactions.getCell("A202").value, "1312155271526625479");
    assert.equal(transactions.getCell("B202").value, 199);
    assert.equal((transactions.getCell("C3").value as Date).toISOString(), date.toISOString());
    const text = transactions.getCell("D3").value as string;
    assert.ok(text.length <= 32_767 && text.isWellFormed());
    assert.equal(transactions.getCell("A2").font.bold, true);
    assert.ok(transactions.autoFilter);
    assert.equal(restored.getWorksheet("Summary")!.getCell("B1").value, 200);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the export archive dependency still handles nested glob patterns and exclusions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynasty-archive-"));
  try {
    await mkdir(join(directory, "nested"));
    await mkdir(join(directory, "skip"));
    await Promise.all([
      writeFile(join(directory, "one.txt"), "one"),
      writeFile(join(directory, ".meta.json"), '{"ok":true}'),
      writeFile(join(directory, "nested", "two.json"), '{"two":2}'),
      writeFile(join(directory, "nested", "space name.txt"), "space"),
      writeFile(join(directory, "skip", "excluded.txt"), "excluded"),
    ]);
    const archive = runtimeRequire("archiver")("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    const finished = new Promise<Buffer>((resolve, reject) => {
      archive.on("data", (chunk: Buffer) => chunks.push(chunk));
      archive.on("error", reject);
      archive.on("end", () => resolve(Buffer.concat(chunks)));
    });
    archive.glob("**/*.{txt,json}", { cwd: directory, dot: true, ignore: ["skip/**"] });
    await archive.finalize();
    const bytes = await finished;
    const zip = await runtimeRequire("jszip").loadAsync(bytes);
    assert.deepEqual(Object.keys(zip.files).sort(), [".meta.json", "nested/space name.txt", "nested/two.json", "one.txt"]);
    assert.equal(await zip.file("nested/two.json").async("string"), '{"two":2}');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
