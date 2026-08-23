"use client";

import { useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { motion } from "framer-motion";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/trello/utils";

/**
 * Shared multi-select popover primitive. Used by MembersPicker and
 * LabelsPicker — anything with the shape "here's a titled list of
 * things, tap to toggle each on/off".
 *
 * The trigger comes in as `children`. Wrap the picker like:
 *   <TogglePopover ...><RailButton ... /></TogglePopover>
 * Radix's `asChild` merges its trigger props into the child, so the
 * child must forward refs (Agent 1's RailButton does).
 */
type TogglePopoverProps<T> = {
  /** The trigger element — passed straight through Popover.Trigger asChild. */
  children: React.ReactNode;
  title: string;
  items: T[];
  selectedIds: string[];
  getId: (item: T) => string;
  /**
   * Optional search predicate. When omitted, no search input is
   * rendered — the list is shown as-is. When provided, a Radix-styled
   * search input sits above the list and auto-focuses on open.
   */
  filter?: (item: T, query: string) => boolean;
  /**
   * Render the row's *label content only* — TogglePopover handles the
   * button shell + checkbox indicator. Keep the returned node compact
   * (avatar + text, color chip + text, etc.).
   */
  renderRow: (item: T) => React.ReactNode;
  onToggle: (id: string) => void;
  searchPlaceholder?: string;
  emptyText?: string;
  side?: React.ComponentProps<typeof Popover.Content>["side"];
  align?: React.ComponentProps<typeof Popover.Content>["align"];
};

export function TogglePopover<T>({
  children,
  title,
  items,
  selectedIds,
  getId,
  filter,
  renderRow,
  onToggle,
  searchPlaceholder = "Search…",
  emptyText = "Nothing to show.",
  side = "left",
  align = "start",
}: TogglePopoverProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    if (!filter) return items;
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => filter(it, q));
  }, [items, filter, query]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setQuery("");
          // rAF so Radix mounts the content before we grab focus
          requestAnimationFrame(() => searchRef.current?.focus());
        }
      }}
    >
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            "z-[60] w-64 overflow-hidden rounded-[10px] surface-modal p-2 shadow-modal outline-none",
            "focus-visible:ring-2 focus-visible:ring-helios-500/40"
          )}
          onOpenAutoFocus={(e) => {
            // Let our rAF handler focus the search input instead of
            // Radix's default (first tabbable child).
            e.preventDefault();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-1 flex items-center justify-between px-1.5 py-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                {title}
              </span>
            </div>

            {filter && (
              <div className="relative mb-1.5">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      if (query) setQuery("");
                      else setOpen(false);
                    }
                  }}
                  placeholder={searchPlaceholder}
                  className={cn(
                    "w-full rounded-[6px] border border-neutral-200 bg-neutral-50",
                    "pl-7 pr-2 py-1.5 text-[12.5px] text-ink-hi placeholder:text-ink-mute",
                    "outline-none transition-colors focus:border-neutral-300 focus:bg-white"
                  )}
                />
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="px-1.5 py-4 text-center text-[12px] text-ink-mute">
                {emptyText}
              </div>
            ) : (
              <ul className="flex max-h-[280px] flex-col overflow-y-auto">
                {filtered.map((item) => {
                  const id = getId(item);
                  const isOn = selected.has(id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => onToggle(id)}
                        className={cn(
                          "group flex w-full items-center gap-2.5 rounded-[6px] px-1.5 py-1.5 text-left outline-none",
                          "transition-colors",
                          "hover:bg-neutral-50",
                          "focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-helios-500/40"
                        )}
                      >
                        <span className="min-w-0 flex-1">{renderRow(item)}</span>
                        <span
                          className={cn(
                            "grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
                            isOn
                              ? "border-heliosGreen-600/60 bg-heliosGreen-600/15 text-heliosGreen-600"
                              : "border-neutral-200 text-transparent group-hover:border-neutral-300"
                          )}
                          aria-hidden
                        >
                          <Check className="h-2.5 w-2.5" strokeWidth={3} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
