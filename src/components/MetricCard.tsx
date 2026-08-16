import type { ReactNode } from "react";

export default function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning";
}) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-300"
      : tone === "negative"
        ? "text-red-300"
        : tone === "warning"
          ? "text-amber-300"
          : "text-neutral-100";

  return (
    <div className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-neutral-500">{label}</div>
      <div className={`mt-1.5 truncate text-xl font-semibold tabular-nums sm:text-2xl ${valueClass}`}>{value}</div>
      {detail ? <div className="mt-1 text-[10px] leading-4 text-neutral-500 sm:text-[11px]">{detail}</div> : null}
    </div>
  );
}
