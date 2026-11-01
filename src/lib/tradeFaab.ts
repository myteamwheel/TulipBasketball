export type FaabTransfer = { amount: number; sender: number; receiver: number };

/** Accept recorded transfers only; a malformed amount must not complete a missing trade side. */
export function parseFaabTransfers(value: string | null): FaabTransfer[] {
  try {
    const rows: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row: unknown) => {
      if (!row || typeof row !== "object") return [];
      const transfer = row as Record<string, unknown>;
      const numeric = (value: unknown) =>
        typeof value === "number" || (typeof value === "string" && value.trim() !== "")
          ? Number(value)
          : NaN;
      const amount = numeric(transfer.amount);
      const sender = numeric(transfer.sender);
      const receiver = numeric(transfer.receiver);
      return Number.isFinite(amount) && amount > 0 &&
        Number.isInteger(sender) && sender > 0 &&
        Number.isInteger(receiver) && receiver > 0 && sender !== receiver
        ? [{ amount, sender, receiver }]
        : [];
    });
  } catch {
    return [];
  }
}

export function faabForRoster(transfers: FaabTransfer[], rosterId: number) {
  return {
    faabSent: transfers.reduce((sum, row) => sum + (row.sender === rosterId ? row.amount : 0), 0),
    faabReceived: transfers.reduce((sum, row) => sum + (row.receiver === rosterId ? row.amount : 0), 0),
  };
}
