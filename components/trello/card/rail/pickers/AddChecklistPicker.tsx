"use client";

import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { motion } from "framer-motion";
import { cn } from "@/lib/trello/utils";

/**
 * Add-checklist picker. Wraps `children` as a Popover.Trigger.
 * Opens a compact form: title input + Add button. Enter submits,
 * Escape cancels. Empty title defaults to "Checklist" — matches the
 * server action's default fallback.
 */
type Props = {
  children: React.ReactNode;
  onAdd: (title: string) => void;
};

const DEFAULT_TITLE = "Checklist";

export function AddChecklistPicker({ children, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const inputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const t = title.trim() || DEFAULT_TITLE;
    onAdd(t);
    setTitle(DEFAULT_TITLE);
    setOpen(false);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setTitle(DEFAULT_TITLE);
          requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
          });
        }
      }}
    >
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="left"
          align="start"
          sideOffset={6}
          className={cn(
            "z-[60] w-60 overflow-hidden rounded-[10px] surface-modal p-3 shadow-modal outline-none",
            "focus-visible:ring-2 focus-visible:ring-helios-500/40"
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <motion.div
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
              Add checklist
            </div>
            <input
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
              placeholder="Checklist title"
              className={cn(
                "mb-2 w-full rounded-[6px] border border-neutral-200 bg-neutral-50",
                "px-2 py-1.5 text-[13px] text-ink-hi outline-none transition-colors",
                "focus:border-neutral-300 focus:bg-white"
              )}
            />
            <button
              type="button"
              onClick={submit}
              className={cn(
                "w-full rounded-[6px] bg-helios-500 px-2 py-1.5 text-[13px] font-medium text-white outline-none",
                "transition-colors hover:bg-helios-600",
                "focus-visible:ring-2 focus-visible:ring-helios-500/50"
              )}
            >
              Add
            </button>
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
