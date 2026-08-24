"use client";

import { cn } from "@/lib/trello/utils";

/**
 * Consistent wrapper for the view screens (My Cards, Due this week,
 * Activity). Holds the title/description header and a scroll container
 * for the view body so each view only cares about its own content.
 */
type Props = {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  empty?: boolean;
  emptyState?: React.ReactNode;
};

export function ViewShell({
  eyebrow,
  title,
  description,
  actions,
  children,
  empty,
  emptyState,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-4 px-4 pb-4 pt-5 sm:gap-6 sm:px-8 sm:pb-8 sm:pt-10">
        <div className="min-w-0">
          <div className="eyebrow eyebrow-ink">{eyebrow}</div>
          <h1 className="mt-2 font-display text-[26px] sm:text-[36px] leading-[1] text-ink-hi">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-[52ch] text-[13.5px] sm:text-[15px] leading-relaxed text-ink-low">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>

      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-8 sm:pb-10")}>
        {empty ? (
          <div className="grid min-h-[40vh] place-items-center">
            {emptyState ?? <DefaultEmpty />}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function DefaultEmpty() {
  return (
    <div className="text-center">
      <div className="eyebrow eyebrow-ink mb-3 opacity-60">Nothing yet</div>
      <div className="font-display text-[24px] text-ink-hi">
        There&rsquo;s nothing here.
      </div>
      <p className="mt-2 max-w-[36ch] text-[14px] text-ink-low">
        This view will fill up as cards come through the workspace.
      </p>
    </div>
  );
}
