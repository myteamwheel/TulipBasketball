export default function DataBadge({
  label,
  state,
  detail,
}: {
  label: string;
  state: "good" | "warn" | "bad" | "neutral";
  detail: string;
}) {
  const dot =
    state === "good"
      ? "bg-emerald-400"
      : state === "warn"
        ? "bg-amber-400"
        : state === "bad"
          ? "bg-red-400"
          : "bg-neutral-500";

  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-950/70 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-[11px] text-neutral-300" title={detail}>{detail}</div>
    </div>
  );
}
