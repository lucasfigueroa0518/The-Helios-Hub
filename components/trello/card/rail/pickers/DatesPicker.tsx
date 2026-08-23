"use client";

import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { motion } from "framer-motion";
import { Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/trello/utils";

/**
 * Dates picker for the card rail. Wraps `children` as a Popover.Trigger.
 *
 * Storage contract: `due` is a full ISO string. We interpret the picked
 * date+time as "wall-clock" (calendar date + clock time as the user
 * typed them) and serialize via `Date.UTC(...)` so every reader sees
 * the same calendar day regardless of timezone — fixes the drift bug
 * called out in AUDIT.md §1 for `CardDetail.tsx:1032`.
 */
type Props = {
  children: React.ReactNode;
  due: string | null | undefined;
  complete: boolean | undefined;
  onChange: (iso: string) => void;
  onClear: () => void;
  onToggleComplete: () => void;
};

const DEFAULT_TIME = "17:00";

export function DatesPicker({
  children,
  due,
  complete,
  onChange,
  onClear,
  onToggleComplete,
}: Props) {
  const [open, setOpen] = useState(false);
  const initial = useMemo(() => splitIso(due), [due]);
  const [dateStr, setDateStr] = useState(initial.date);
  const [timeStr, setTimeStr] = useState(initial.time);
  const [useTime, setUseTime] = useState(initial.hasCustomTime);

  // Re-sync from parent when the card actually changes (opening a
  // different card, or an optimistic clear from elsewhere).
  useEffect(() => {
    const next = splitIso(due);
    setDateStr(next.date);
    setTimeStr(next.time);
    setUseTime(next.hasCustomTime);
  }, [due]);

  function commit(nextDate: string, nextTime: string | null) {
    if (!nextDate) {
      onClear();
      return;
    }
    onChange(buildIso(nextDate, nextTime ?? DEFAULT_TIME));
  }

  function applyPreset(offsetDays: number) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    setDateStr(iso);
    commit(iso, useTime ? timeStr : DEFAULT_TIME);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="left"
          align="start"
          sideOffset={6}
          className={cn(
            "z-[60] w-72 overflow-hidden rounded-[10px] surface-modal p-3 shadow-modal outline-none",
            "focus-visible:ring-2 focus-visible:ring-helios-500/40"
          )}
        >
          <motion.div
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
              Due date
            </div>

            <input
              type="date"
              value={dateStr}
              onChange={(e) => {
                const v = e.target.value;
                setDateStr(v);
                // Empty → clear (fixes AUDIT.md §5: backspace in the
                // native picker used to be a silent no-op).
                if (!v) {
                  onClear();
                  return;
                }
                commit(v, useTime ? timeStr : DEFAULT_TIME);
              }}
              className={cn(
                "w-full rounded-[6px] border border-neutral-200 bg-neutral-50",
                "px-2 py-1.5 text-[13px] text-ink-hi outline-none transition-colors",
                "focus:border-neutral-300 focus:bg-white"
              )}
            />

            {/* Presets — one tap, no calendar drilling. */}
            <div className="mt-2 flex gap-1.5">
              <PresetChip onClick={() => applyPreset(0)}>Today</PresetChip>
              <PresetChip onClick={() => applyPreset(1)}>Tomorrow</PresetChip>
              <PresetChip onClick={() => applyPreset(7)}>+1 week</PresetChip>
            </div>

            {/* Time toggle + input */}
            <div className="mt-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-[6px] px-1 py-1 text-[12.5px] text-ink-mid hover:text-ink-hi">
                <span
                  className={cn(
                    "grid h-4 w-4 place-items-center rounded-[4px] border transition-colors",
                    useTime
                      ? "border-heliosGreen-600/60 bg-heliosGreen-600/15 text-heliosGreen-600"
                      : "border-neutral-200 text-transparent"
                  )}
                  aria-hidden
                >
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={useTime}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setUseTime(on);
                    if (dateStr) {
                      commit(dateStr, on ? timeStr : DEFAULT_TIME);
                    }
                  }}
                />
                Add time
              </label>
              {useTime && (
                <input
                  type="time"
                  value={timeStr}
                  onChange={(e) => {
                    const v = e.target.value || DEFAULT_TIME;
                    setTimeStr(v);
                    if (dateStr) commit(dateStr, v);
                  }}
                  className={cn(
                    "mt-1.5 w-full rounded-[6px] border border-neutral-200 bg-neutral-50",
                    "px-2 py-1.5 text-[13px] text-ink-hi outline-none transition-colors",
                    "focus:border-neutral-300 focus:bg-white"
                  )}
                />
              )}
            </div>

            <div className="my-3 h-px bg-neutral-200" />

            <button
              type="button"
              onClick={onToggleComplete}
              className={cn(
                "flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1.5 text-left text-[12.5px]",
                "text-ink-mid transition-colors hover:bg-neutral-50 hover:text-ink-hi"
              )}
            >
              <span
                className={cn(
                  "grid h-4 w-4 place-items-center rounded-[4px] border transition-colors",
                  complete
                    ? "border-heliosGreen-600/60 bg-heliosGreen-600/15 text-heliosGreen-600"
                    : "border-neutral-200 text-transparent"
                )}
                aria-hidden
              >
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
              Mark complete
            </button>

            {due && (
              <button
                type="button"
                onClick={onClear}
                className={cn(
                  "mt-0.5 flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1.5 text-left text-[12.5px]",
                  "text-ink-mid transition-colors hover:bg-neutral-50 hover:text-ink-hi"
                )}
              >
                <Trash2 className="h-3.5 w-3.5 text-ink-mute" />
                Remove date
              </button>
            )}
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PresetChip({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11.5px] text-ink-mid outline-none",
        "transition-colors hover:border-neutral-300 hover:text-ink-hi",
        "focus-visible:ring-2 focus-visible:ring-helios-500/50"
      )}
    >
      {children}
    </button>
  );
}

// ── ISO helpers ────────────────────────────────────────────────────
// Wall-clock convention: interpret picked date/time as if UTC, so the
// same calendar day + clock time surfaces for every viewer regardless
// of their local timezone.

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function buildIso(dateStr: string, timeStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi)).toISOString();
}

function splitIso(iso: string | null | undefined) {
  if (!iso) return { date: "", time: DEFAULT_TIME, hasCustomTime: false };
  const d = new Date(iso);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  // If the stored time matches our default (legacy 17:00 rows), treat
  // it as "no custom time" so the "Add time" checkbox stays quiet.
  return { date, time, hasCustomTime: time !== DEFAULT_TIME };
}
