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
        <h2 className="text-lg font-semibold tracking-tight text-neutral-100">{title}</h2>
        {description ? <details className="text-sm text-neutral-400"><summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm text-neutral-500 hover:text-neutral-300 [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-neutral-600 text-xs">i</span>How this works</summary><p className="mt-1 max-w-3xl leading-6">{description}</p></details> : null}
      </div>
      {href && hrefLabel ? (
        <Link href={href} className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-emerald-400 hover:text-emerald-300 hover:underline">
          {hrefLabel}
        </Link>
      ) : null}
    </div>
  );
}
