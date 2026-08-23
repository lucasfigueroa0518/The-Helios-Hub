"use client";

import * as React from "react";
import { cn } from "@/lib/trello/utils";

export function RailShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        // Mobile: full-width horizontal band above the description
        // (parent flex-col-reverse places us on top). Above sm we
        // recover the original desktop side-rail shape.
        "flex w-full shrink-0 flex-col border-neutral-200 sm:w-[196px] sm:border-l sm:pl-6",
        className,
      )}
    >
      {children}
    </aside>
  );
}

export function RailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 pt-5 border-t border-neutral-200/70 first:mt-0 first:pt-0 first:border-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
        {label}
      </div>
      {/* Sub-buttons stack vertically on desktop but wrap horizontally
          on mobile so all five picker actions stay visible without the
          rail dominating the visible modal area. */}
      <div className="mt-2 flex flex-wrap gap-1.5 sm:flex-col">{children}</div>
    </section>
  );
}
