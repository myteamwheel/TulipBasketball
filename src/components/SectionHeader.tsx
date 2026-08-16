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
        {description ? <p className="mt-0.5 text-[11px] leading-4 text-neutral-500">{description}</p> : null}
      </div>
      {href && hrefLabel ? (
        <Link href={href} className="shrink-0 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:underline">
          {hrefLabel}
        </Link>
      ) : null}
    </div>
  );
}
