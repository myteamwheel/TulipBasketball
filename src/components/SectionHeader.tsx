import Link from "next/link";

export default function SectionHeader({
  title,
  description,
  href,
  hrefLabel,
}: {
  title: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
        {description ? <details className="mt-1 text-xs text-neutral-400"><summary className="cursor-pointer list-none text-[11px] text-neutral-500 hover:text-neutral-300 [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-neutral-600 text-[9px]">i</span>How this works</summary><p className="mt-1 max-w-3xl leading-5">{description}</p></details> : null}
      </div>
      {href && hrefLabel ? (
        <Link href={href} className="shrink-0 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:underline">
          {hrefLabel}
        </Link>
      ) : null}
    </div>
  );
}
