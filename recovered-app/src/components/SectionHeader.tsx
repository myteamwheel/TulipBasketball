import type { ReactNode } from "react";

export default function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.18em] text-emerald-400/80">{eyebrow}</div>}
        <h2 className="text-base font-semibold text-neutral-100 sm:text-lg">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-neutral-500 sm:text-sm">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
