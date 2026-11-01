import assert from "node:assert/strict";
import test from "node:test";
import { excelValue } from "./excelCell";

test("Excel exports preserve large integer identifiers without rounding them", () => {
  assert.equal(excelValue(BigInt("1312155271526625280")), "1312155271526625280");
  assert.equal(excelValue(BigInt(1234)), 1234);
  assert.equal(excelValue({ transactionId: BigInt("1312155271526625280") }), '{"transactionId":"1312155271526625280"}');
});

test("raw strings and JSON respect Excel's cell limit without splitting Unicode", () => {
  for (const input of ["x".repeat(40_000), "🏈".repeat(20_000), { payload: "🏈".repeat(20_000) }]) {
    const result = excelValue(input) as string;
    assert.ok(result.length <= 32_767);
    assert.match(result, /truncated for Excel cell limit/);
    assert.ok(result.isWellFormed());
  }
  const exact = "x".repeat(32_767);
  assert.equal(excelValue(exact), exact);
});

test("invalid numbers and dates export as blank cells while valid values retain their types", () => {
  for (const value of [NaN, Infinity, -Infinity, new Date("invalid"), null, undefined]) assert.equal(excelValue(value), null);
  assert.equal(excelValue(false), false);
  assert.equal(excelValue(12.5), 12.5);
  const date = new Date("2026-11-01T12:00:00Z");
  assert.equal(excelValue(date), date);
});
