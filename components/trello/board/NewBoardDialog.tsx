"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/trello/utils";
import type { Workspace } from "@/lib/trello/types";

/**
 * Constrained board-accent palette. Board accents are identity chips
 * (sidebar dot, board-title chip, list-card gradient), NOT CTAs — so
 * we're free to use colors beyond helios-500. Palette kept tight to
 * avoid boards trending toward Trello-rainbow: two brand colors, plus
 * three neutral shades for boards that want to fade back.
 */
const ACCENTS = [
  { value: "#FF5E1A", label: "Orange" },
  { value: "#38B368", label: "Green" },
  { value: "#5B7185", label: "Slate" },
  { value: "#7F7B72", label: "Warm gray" },
  { value: "#2A2A2A", label: "Ink" },
] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  defaultWorkspaceId: string;
  onCreate: (name: string, workspaceId: string, accent: string) => string | null;
};

export function NewBoardDialog({
  open,
  onOpenChange,
  workspaces,
  defaultWorkspaceId,
  onCreate,
}: Props) {
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId);
  const [accent, setAccent] = useState<string>(ACCENTS[0].value);
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset form each time the dialog opens so the previous draft doesn't
  // linger. Also refocus the name field — this is a create flow, we
  // want the caret on the first field immediately.
  useEffect(() => {
    if (open) {
      setName("");
      setWorkspaceId(defaultWorkspaceId);
      setAccent(ACCENTS[0].value);
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  }, [open, defaultWorkspaceId]);

  function commit() {
    const t = name.trim();
    if (!t) return;
    onCreate(t, workspaceId, accent);
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="fixed inset-0 z-50 bg-black/40"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                initial={{ opacity: 0, x: "-50%", y: "calc(-50% + 8px)", scale: 0.985 }}
                animate={{ opacity: 1, x: "-50%", y: "-50%", scale: 1 }}
                exit={{ opacity: 0, x: "-50%", y: "calc(-50% + 4px)", scale: 0.99 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="fixed left-1/2 top-1/2 z-50 w-[420px] surface-modal rounded-[14px] shadow-modal"
              >
                <div className="flex items-start justify-between px-5 pt-5 pb-2">
                  <div>
                    <Dialog.Title className="font-display text-[16px] text-ink-hi">
                      Create board
                    </Dialog.Title>
                    <Dialog.Description className="mt-0.5 text-[12.5px] text-ink-mute">
                      New boards start with three lists: To do · In progress · Done.
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      className="rounded p-1 text-ink-mute hover:bg-neutral-50 hover:text-ink-mid transition-colors"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Dialog.Close>
                </div>

                <div className="px-5 pb-5 pt-3">
                  {/* Board name */}
                  <label className="mb-3 block">
                    <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                      Board name
                    </span>
                    <input
                      ref={nameRef}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commit();
                        }
                      }}
                      placeholder="e.g. Q4 launch plan"
                      className="w-full rounded-[8px] border border-neutral-200 bg-white px-2.5 py-2 text-[13.5px] text-ink-hi outline-none focus:border-helios-500/60"
                    />
                  </label>

                  {/* Workspace picker */}
                  <label className="mb-3 block">
                    <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                      Workspace
                    </span>
                    <select
                      value={workspaceId}
                      onChange={(e) => setWorkspaceId(e.target.value)}
                      className="w-full rounded-[8px] border border-neutral-200 bg-white px-2.5 py-2 text-[13.5px] text-ink-hi outline-none focus:border-helios-500/60"
                    >
                      {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* Accent swatches */}
                  <div className="mb-4">
                    <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                      Accent
                    </span>
                    <div className="flex gap-2">
                      {ACCENTS.map((a) => (
                        <button
                          key={a.value}
                          type="button"
                          onClick={() => setAccent(a.value)}
                          className={cn(
                            "h-7 w-7 rounded-full transition-transform",
                            "hover:scale-110",
                            accent === a.value &&
                              "ring-2 ring-offset-2 ring-offset-white ring-ink-hi",
                          )}
                          style={{ background: a.value }}
                          aria-label={a.label}
                          title={a.label}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Dialog.Close asChild>
                      <button className="rounded-full px-3.5 py-1.5 text-[12.5px] text-ink-mid hover:bg-neutral-50 hover:text-ink-hi transition-colors">
                        Cancel
                      </button>
                    </Dialog.Close>
                    <button
                      onClick={commit}
                      disabled={!name.trim()}
                      className="rounded-full bg-helios-500 px-4 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-helios-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Create board
                    </button>
                  </div>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
