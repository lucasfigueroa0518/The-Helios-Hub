"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/trello/ui/Button";

type Props = {
  onAdd: (name: string) => void;
};

export function AddListComposer({ onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function commit() {
    const t = name.trim();
    if (t) onAdd(t);
    setName("");
    // Keep composer open — Trello behavior lets you add several in a row.
  }

  function close() {
    setName("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-[288px] shrink-0 items-center gap-2 rounded-[10px] bg-neutral-50 px-3 text-[13px] text-ink-mid transition-colors hover:bg-neutral-100 hover:text-ink-hi dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" />
        Add another list
      </button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
      className="flex w-[288px] shrink-0 flex-col gap-2 rounded-[10px] bg-neutral-50 p-2 dark:bg-white/[0.06]"
    >
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") close();
        }}
        placeholder="Enter list title…"
        className="h-8 w-full rounded-[6px] border border-neutral-200 bg-white px-2.5 text-[13.5px] font-semibold text-ink-hi outline-none placeholder:font-normal placeholder:text-ink-mute focus:border-helios-500/60 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={commit} disabled={!name.trim()}>
          Add list
        </Button>
        <button
          onClick={close}
          className="grid h-8 w-8 place-items-center rounded-[6px] text-ink-mid hover:bg-neutral-50 hover:text-ink-hi transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}
