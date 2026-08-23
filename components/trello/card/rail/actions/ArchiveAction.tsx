"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Archive } from "lucide-react";
import { RailButton } from "@/components/trello/card/rail/RailButton";

export function ArchiveAction({ onArchive }: { onArchive: () => void }) {
  const [open, setOpen] = useState(false);

  function confirm() {
    onArchive();
    setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <RailButton icon={<Archive className="h-3.5 w-3.5" strokeWidth={2} />}>
          Archive
        </RailButton>
      </Dialog.Trigger>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
                className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[1px]"
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              onOpenAutoFocus={(e) => {
                e.preventDefault();
              }}
            >
              <div className="fixed inset-0 z-[80] grid place-items-center p-4 pointer-events-none">
                <motion.div
                  initial={{ opacity: 0, scale: 0.98, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: 8 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="w-[min(380px,92vw)] rounded-[12px] surface-modal shadow-modal p-5 pointer-events-auto"
                >
                  <Dialog.Title className="text-[15px] font-semibold text-ink-hi">
                    Archive this card?
                  </Dialog.Title>
                  <Dialog.Description className="mt-1.5 text-[13px] leading-[1.5] text-ink-mid">
                    It moves to the board archive. You can restore it later from
                    Archived boards.
                  </Dialog.Description>
                  <div className="mt-5 flex justify-end gap-2">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-[6px] px-3 py-1.5 text-[13px] text-ink-mid transition-colors duration-150 ease-expo hover:bg-neutral-100 hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
                      >
                        Cancel
                      </button>
                    </Dialog.Close>
                    <button
                      type="button"
                      onClick={confirm}
                      autoFocus
                      className="rounded-[6px] bg-danger px-3 py-1.5 text-[13px] font-medium text-white transition-colors duration-150 ease-expo hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50 focus-visible:ring-offset-1"
                    >
                      Archive
                    </button>
                  </div>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
