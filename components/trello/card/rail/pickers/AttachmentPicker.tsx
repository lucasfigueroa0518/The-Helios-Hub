"use client";

import { useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { motion } from "framer-motion";
import { Link as LinkIcon, AlertCircle } from "lucide-react";
import { cn } from "@/lib/trello/utils";

/**
 * Attachment picker — paste-URL flow. Wraps `children` as a
 * Popover.Trigger. Foundation for file-upload later; today the
 * "Attach" action just adds a link entry.
 *
 * Guards from AUDIT.md §7:
 *   • Bare `foo.com` gets `https://` prepended before validation.
 *   • Anything that doesn't parse via `new URL()` is rejected.
 *   • Only `http:` / `https:` protocols pass through — a
 *     `javascript:` URL would be a click-time XSS vector.
 */
type Props = {
  children: React.ReactNode;
  onAdd: (url: string, title: string) => void;
};

export function AttachmentPicker({ children, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const urlRef = useRef<HTMLInputElement>(null);

  const validation = useMemo(() => validateLink(url), [url]);
  const canSubmit = validation.ok;

  function submit() {
    if (!canSubmit) return;
    onAdd(validation.href, title.trim());
    setUrl("");
    setTitle("");
    setOpen(false);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setUrl("");
          setTitle("");
          requestAnimationFrame(() => urlRef.current?.focus());
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
            "z-[60] w-72 overflow-hidden rounded-[10px] surface-modal p-3 shadow-modal outline-none",
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
              Attach a link
            </div>

            <div className="relative mb-2">
              <LinkIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" />
              <input
                ref={urlRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
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
                placeholder="https://…"
                spellCheck={false}
                className={cn(
                  "w-full rounded-[6px] border bg-neutral-50",
                  "pl-7 pr-2 py-1.5 text-[13px] text-ink-hi outline-none transition-colors",
                  "focus:bg-white",
                  validation.state === "error"
                    ? "border-danger/60 focus:border-danger"
                    : "border-neutral-200 focus:border-neutral-300"
                )}
              />
            </div>

            <input
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
              placeholder="Display text (optional)"
              className={cn(
                "mb-2 w-full rounded-[6px] border border-neutral-200 bg-neutral-50",
                "px-2 py-1.5 text-[13px] text-ink-hi outline-none transition-colors",
                "focus:border-neutral-300 focus:bg-white"
              )}
            />

            {validation.state === "error" && (
              <div className="mb-2 flex items-start gap-1.5 text-[11.5px] text-danger">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{validation.message}</span>
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className={cn(
                "w-full rounded-[6px] bg-helios-500 px-2 py-1.5 text-[13px] font-medium text-white outline-none",
                "transition-colors hover:bg-helios-600",
                "focus-visible:ring-2 focus-visible:ring-helios-500/50",
                "disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-ink-mute"
              )}
            >
              Attach
            </button>
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── URL validation ────────────────────────────────────────────────
// Returns { ok, href, state, message }. `href` is the normalized URL
// to actually save (may differ from input — `https://` prepended, etc.).

type Validation =
  | { ok: true; href: string; state: "idle" | "valid" }
  | { ok: false; href: string; state: "idle" | "error"; message: string };

function validateLink(input: string): Validation {
  const raw = input.trim();
  if (!raw) return { ok: false, href: "", state: "idle", message: "" };

  // Bare hostnames get `https://` — the common paste case.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return {
      ok: false,
      href: "",
      state: "error",
      message: "That doesn't look like a valid URL.",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      href: "",
      state: "error",
      message: "Only http and https links are supported.",
    };
  }

  // Reject hostname-less inputs like "https://" alone.
  if (!parsed.hostname) {
    return {
      ok: false,
      href: "",
      state: "error",
      message: "Missing a hostname.",
    };
  }

  return { ok: true, href: parsed.toString(), state: "valid" };
}
