const MAX_CELL_LENGTH = 32_767;
const TRUNCATED = "…[truncated for Excel cell limit]";

function cellText(text: string): string {
  if (text.length <= MAX_CELL_LENGTH) return text;
  let prefix = text.slice(0, MAX_CELL_LENGTH - TRUNCATED.length);
  const last = prefix.charCodeAt(prefix.length - 1);
  // Excel/XML must not receive half of a surrogate pair at the truncation point.
  if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1);
  return prefix + TRUNCATED;
}

/** Preserve large identifiers and keep every exported cell valid for Excel. */
export function excelValue(value: unknown): string | number | boolean | Date | null {
  if (value == null) return null;
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString();
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "string") return cellText(value);
  try {
    return cellText(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item) ?? String(value));
  } catch {
    return cellText(String(value));
  }
}
