"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { motion } from "framer-motion";
import { Check, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/trello/utils";
import type { Board } from "@/lib/trello/types";

type Label = Board["labels"][number];

type Props = {
  children: React.ReactNode;
  boardId: string;
  labels: Label[];
  selectedIds: string[];
  onToggle: (labelId: string) => void;
  onCreate: (name: string, color: string) => void;
  onRename: (labelId: string, name: string) => void;
  onDelete: (labelId: string) => void;
};

/**
 * Curated label palette. Kept small so board label spaces stay legible
 * — Trello-rainbow is chaotic; a tight set reads better in the tiny
 * chip surface. Colors mix DS anchors (helios-500, warning, heliosGreen-600)
 * with tags-friendly extensions.
 */
const LABEL_COLORS: readonly string[] = [
  "#FF5E1A", // helios orange
  "#F0A64A", // warning amber
  "#138510", // helios green
  "#0079BF", // blue
  "#C377E0", // purple
  "#EB5A46", // rose
  "#5B7185", // slate
  "#2A2A2A", // ink
];

export function LabelsPicker({
  children,
  labels,
  selectedIds,
  onToggle,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(LABEL_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return labels;
    return labels.filter((l) => l.name.toLowerCase().includes(q));
  }, [labels, query]);

  useEffect(() => {
    if (creating) {
      requestAnimationFrame(() => createRef.current?.focus());
    }
  }, [creating]);

  useEffect(() => {
    if (editingId) {
      requestAnimationFrame(() => {
        editRef.current?.focus();
        editRef.current?.select();
      });
    }
  }, [editingId]);

  function resetOnOpen() {
    setQuery("");
    setCreating(false);
    setNewName("");
    setNewColor(LABEL_COLORS[0]);
    setEditingId(null);
    setEditingDraft("");
  }

  function commitCreate() {
    const t = newName.trim();
    if (!t) return;
    onCreate(t, newColor);
    setNewName("");
    setCreating(false);
  }

  function beginRename(label: Label) {
    setEditingId(label.id);
    setEditingDraft(label.name);
  }

  function commitRename() {
    if (!editingId) return;
    const t = editingDraft.trim();
    if (t) onRename(editingId, t);
    setEditingId(null);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          resetOnOpen();
          requestAnimationFrame(() => searchRef.current?.focus());
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
            "z-[60] w-72 overflow-hidden rounded-[10px] surface-modal p-2 shadow-modal outline-none",
            "focus-visible:ring-2 focus-visible:ring-helios-500/40",
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <motion.div
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-1 flex items-center justify-between px-1.5 py-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                Labels
              </span>
            </div>

            {/* Search */}
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
                placeholder="Search labels"
                className={cn(
                  "w-full rounded-[6px] border border-neutral-200 bg-neutral-50",
                  "pl-7 pr-2 py-1.5 text-[12.5px] text-ink-hi placeholder:text-ink-mute",
                  "outline-none transition-colors focus:border-neutral-300 focus:bg-white",
                )}
              />
            </div>

            {/* Labels list */}
            {filtered.length === 0 ? (
              <div className="px-1.5 py-4 text-center text-[12px] text-ink-mute">
                No labels match.
              </div>
            ) : (
              <ul className="flex max-h-[280px] flex-col overflow-y-auto">
                {filtered.map((l) => {
                  const isOn = selected.has(l.id);
                  const isEditing = editingId === l.id;
                  return (
                    <li key={l.id} className="group/label">
                      <div
                        className={cn(
                          "flex items-center gap-1.5 rounded-[6px] px-1.5 py-1.5",
                          "transition-colors",
                          !isEditing && "hover:bg-neutral-50",
                        )}
                      >
                        {isEditing ? (
                          <input
                            ref={editRef}
                            value={editingDraft}
                            onChange={(e) => setEditingDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitRename();
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                setEditingId(null);
                              }
                            }}
                            onBlur={commitRename}
                            className={cn(
                              "block h-6 min-w-0 flex-1 rounded-[4px] px-2 text-[11px] font-semibold uppercase tracking-[0.02em] text-white outline-none",
                              "focus:ring-2 focus:ring-white/40",
                            )}
                            style={{ background: safeColor(l.color) }}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => onToggle(l.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-helios-500/40 rounded-[4px]"
                          >
                            <span
                              className="flex h-6 min-w-0 flex-1 items-center truncate rounded-[4px] px-2 text-[11px] font-semibold uppercase tracking-[0.02em] text-white"
                              style={{ background: safeColor(l.color) }}
                              title={l.name}
                            >
                              {l.name}
                            </span>
                            <span
                              className={cn(
                                "grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
                                isOn
                                  ? "border-heliosGreen-600/60 bg-heliosGreen-600/15 text-heliosGreen-600"
                                  : "border-neutral-200 text-transparent",
                              )}
                              aria-hidden
                            >
                              <Check className="h-2.5 w-2.5" strokeWidth={3} />
                            </span>
                          </button>
                        )}

                        {!isEditing && (
                          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/label:opacity-100 focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() => beginRename(l)}
                              className="grid h-5 w-5 place-items-center rounded-[4px] text-ink-mute transition-colors hover:bg-neutral-100 hover:text-ink-hi outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-helios-500/40"
                              aria-label={`Rename ${l.name}`}
                              title="Rename"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDelete(l.id)}
                              className="grid h-5 w-5 place-items-center rounded-[4px] text-ink-mute transition-colors hover:bg-danger/10 hover:text-danger outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-danger/40"
                              aria-label={`Delete ${l.name}`}
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Divider */}
            <div className="my-1.5 h-px bg-neutral-100" />

            {/* Create */}
            {creating ? (
              <div className="p-1.5">
                <input
                  ref={createRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitCreate();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setCreating(false);
                    }
                  }}
                  placeholder="Label name"
                  className={cn(
                    "mb-2 block h-8 w-full rounded-[6px] px-2 text-[12px] font-semibold uppercase tracking-[0.02em] text-white outline-none",
                    "focus:ring-2 focus:ring-white/40",
                  )}
                  style={{ background: newColor }}
                />
                <ColorRow value={newColor} onChange={setNewColor} />
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="flex-1 rounded-[6px] px-2 py-1.5 text-[12px] text-ink-mid hover:bg-neutral-50 hover:text-ink-hi transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={commitCreate}
                    disabled={!newName.trim()}
                    className="flex-1 rounded-[6px] bg-helios-500 px-2 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-helios-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Add label
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1.5 text-left text-[12.5px] text-ink-mid transition-colors hover:bg-neutral-50 hover:text-ink-hi"
              >
                <Plus className="h-3.5 w-3.5" />
                Create a new label
              </button>
            )}
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Compact color palette shown only inside the create form. Changing an
 * existing label's color isn't a first-class action here — delete +
 * recreate covers it and keeps the picker restrained.
 */
function ColorRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {LABEL_COLORS.map((c) => {
        const active = c === value;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn(
              "grid h-6 w-6 place-items-center rounded-[4px] outline-none transition-transform",
              "hover:scale-110",
              active && "ring-2 ring-offset-1 ring-offset-white ring-ink-hi",
            )}
            style={{ background: c }}
            aria-label={`Color ${c}`}
          >
            {active && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

// Only allow `#RRGGBB` / `#RGB` through as an inline background. Anything
// weird falls back to the neutral chip color — matches the AUDIT.md §7
// finding about unvalidated accent strings flowing into inline CSS.
function safeColor(input: string) {
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(input)) return input;
  return "#A3A3A3";
}
