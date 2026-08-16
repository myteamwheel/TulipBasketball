import { formatSigned, trendColorClass } from "@/lib/format";

export default function WindowValue({ value, coverage, total }: { value: number | null | undefined; coverage?: number; total?: number }) {
  if (value === null || value === undefined) {
    return (
      <span className="text-neutral-500" title="No observation close enough to the requested historical window. The dashboard does not substitute an older checkpoint.">
        —
      </span>
    );
  }
  return (
    <span className={trendColorClass(value)} title={coverage !== undefined && total !== undefined ? `${coverage}/${total} current roster players have a valid comparison point for this window.` : undefined}>
      {formatSigned(value)}
    </span>
  );
}
