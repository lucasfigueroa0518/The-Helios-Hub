"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/trello/utils";
import type { Checklist } from "@/lib/trello/types";

type Props = {
  checklist: Checklist;
  onToggle: (itemId: string) => void;
  onAdd: (text: string) => void;
  onDelete: (itemId: string) => void;
};

export function ChecklistBlock({ checklist, onToggle, onAdd, onDelete }: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const total = checklist.items.length;
  const done = checklist.items.filter((i) => i.done).length;
  const pct = total > 0 ? (done / total) * 100 : 0;
  const complete = total > 0 && done === total;

  function commit() {
    const t = draft.trim();
    if (t) onAdd(t);
    setDraft("");
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[14px] font-semibold text-ink-hi">{checklist.title}</h3>
        <span
          className={cn(
            "text-[11px] tabular-nums",
            complete ? "text-heliosGreen-400" : "text-ink-mute"
          )}
        >
          {done}/{total}
        </span>
      </div>

      {/* Progress — one of the five sunset surfaces */}
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-50">
        <motion.div
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "h-full rounded-full",
            complete ? "bg-heliosGreen-400" : "bg-sunset-linear"
          )}
        />
      </div>

      <ul className="mb-1 flex flex-col">
        <AnimatePresence initial={false}>
          {checklist.items.map((it) => (
            <motion.li
              key={it.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, height: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="group flex items-center gap-2.5 rounded-[6px] py-1.5 pr-2 hover:bg-neutral-50"
            >
              <button
                onClick={() => onToggle(it.id)}
                className={cn(
                  "grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
                  it.done
                    ? "border-heliosGreen-400/60 bg-heliosGreen-400/20 text-heliosGreen-400"
                    : "border-neutral-200 hover:border-neutral-300"
                )}
                aria-label={it.done ? "Mark incomplete" : "Mark complete"}
              >
                <motion.span
                  initial={false}
                  animate={{ scale: it.done ? 1 : 0, opacity: it.done ? 1 : 0 }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </motion.span>
              </button>
              <span
                className={cn(
                  "flex-1 text-[13.5px] leading-[1.4]",
                  it.done ? "text-ink-mute line-through" : "text-ink-hi"
                )}
              >
                {it.text}
              </span>
              <button
                onClick={() => onDelete(it.id)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded p-1 text-ink-mute opacity-100 sm:opacity-0 transition-opacity hover:bg-neutral-100 hover:text-ink-hi group-hover:opacity-100"
                aria-label="Delete item"
              >
                <X className="h-3 w-3" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {adding ? (
        <div className="mt-2 flex flex-col gap-2 pl-6">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            placeholder="Add an item"
            className="h-9 rounded-[6px] border border-neutral-200 bg-white px-2.5 text-[16px] sm:text-[13px] text-ink-hi placeholder:text-ink-mute outline-none focus:border-helios-500/60"
          />
          <div className="flex gap-2">
            <button
              onClick={commit}
              disabled={!draft.trim()}
              className="rounded-[6px] bg-helios-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-helios-600 disabled:opacity-50 disabled:pointer-events-none"
            >
              Add
            </button>
            <button
              onClick={() => {
                setDraft("");
                setAdding(false);
              }}
              className="rounded-[6px] px-2 py-1 text-[12px] text-ink-mid hover:bg-neutral-50 hover:text-ink-hi"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-1 flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[12.5px] text-ink-mute hover:bg-neutral-50 hover:text-ink-mid transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add an item
        </button>
      )}
    </section>
  );
}
