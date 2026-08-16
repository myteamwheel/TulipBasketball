export default function SignalBadge({ signal, score, confidence }: { signal: string; score?: number | null; confidence?: string | null }) {
  const style: Record<string, string> = {
    SELL_HIGH: "border-amber-800 bg-amber-950/50 text-amber-300",
    BUY_LOW: "border-sky-800 bg-sky-950/50 text-sky-300",
    HOLD: "border-neutral-700 bg-neutral-800 text-neutral-300",
    CUT_BAIT: "border-red-800 bg-red-950/50 text-red-300",
    WATCH: "border-violet-800 bg-violet-950/50 text-violet-300",
  };

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold ${style[signal] ?? style.HOLD}`}>
      <span>{signal.replaceAll("_", " ")}</span>
      {score !== null && score !== undefined ? <span className="font-normal opacity-70">{score}/100</span> : null}
      {confidence ? <span className="hidden font-normal opacity-60 sm:inline">{confidence}</span> : null}
    </span>
  );
}
