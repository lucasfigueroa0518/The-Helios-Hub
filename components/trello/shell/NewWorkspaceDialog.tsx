"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Server-side create. Optimistic switch to the new workspace happens
   *  in the caller once the promise resolves. */
  onCreate: (name: string, description: string) => Promise<void>;
};

export function NewWorkspaceDialog({ open, onOpenChange, onCreate }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
      setBusy(false);
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  }, [open]);

  async function commit() {
    const t = name.trim();
    if (!t || busy) return;
    setError(null);
    setBusy(true);
    try {
      await onCreate(t, description.trim());
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't create the workspace.",
      );
    } finally {
      setBusy(false);
    }
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
                      Create workspace
                    </Dialog.Title>
                    <Dialog.Description className="mt-0.5 text-[12.5px] text-ink-mute">
                      A new home for boards. You&apos;re the owner.
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
                  <label className="mb-3 block">
                    <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                      Workspace name
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
                      placeholder="e.g. Helios Ventures"
                      className="w-full rounded-[8px] border border-neutral-200 bg-white px-2.5 py-2 text-[13.5px] text-ink-hi outline-none focus:border-helios-500/60"
                    />
                  </label>

                  <label className="mb-4 block">
                    <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                      Description
                      <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-mute/70">
                        optional
                      </span>
                    </span>
                    <input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commit();
                        }
                      }}
                      placeholder="What lives in this workspace?"
                      className="w-full rounded-[8px] border border-neutral-200 bg-white px-2.5 py-2 text-[13.5px] text-ink-hi outline-none focus:border-helios-500/60"
                    />
                  </label>

                  {error && (
                    <p className="mb-3 text-[12px] text-danger">{error}</p>
                  )}

                  <div className="flex items-center justify-end gap-2">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-full px-3.5 py-1.5 text-[12.5px] text-ink-mid hover:bg-neutral-50 hover:text-ink-hi transition-colors"
                      >
                        Cancel
                      </button>
                    </Dialog.Close>
                    <button
                      type="button"
                      onClick={commit}
                      disabled={!name.trim() || busy}
                      className="rounded-full bg-helios-500 px-4 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-helios-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {busy ? "Creating…" : "Create workspace"}
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
