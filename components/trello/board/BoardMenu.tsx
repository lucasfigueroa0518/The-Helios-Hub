"use client";

import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { HexColorPicker } from "react-colorful";
import { MoreHorizontal, Pencil, Palette, Archive, Trash2, Check, UserPlus, Paintbrush, Sun, Moon, Pipette, RotateCcw } from "lucide-react";
import { cn } from "@/lib/trello/utils";
import type { Board, User } from "@/lib/trello/types";
import { UserLookup } from "@/components/trello/shell/UserLookup";

/**
 * Same tight palette as NewBoardDialog — keeps boards visually
 * consistent whether they're being created or re-skinned later.
 */
const ACCENTS = [
  { value: "#FF5E1A", label: "Orange" },
  { value: "#38B368", label: "Green" },
  { value: "#5B7185", label: "Slate" },
  { value: "#7F7B72", label: "Warm gray" },
  { value: "#2A2A2A", label: "Ink" },
] as const;

type Props = {
  board: Board;
  shareCandidates: User[];
  onRename: (name: string) => void;
  onSetAccent: (accent: string) => void;
  onSetTheme: (theme: "light" | "dark") => void;
  onSetCanvas: (canvas: string | null) => void;
  onArchive: () => void;
  onDelete: () => void;
  onShare: (userId: string) => Promise<void>;
};

type Mode = "root" | "rename" | "accent" | "canvas" | "share" | "confirm-delete";

/**
 * Curated canvas swatches. Fig asked for full HSL freedom via the
 * native color picker (below), and these are opinionated shortcuts
 * for the common cases — bright, warm, cool, dark. Same swatch set
 * for both themes; picker is the escape valve.
 */
const CANVAS_PRESETS = [
  { value: "#FFFFFF", label: "White" },
  { value: "#F5F5F5", label: "Paper" },
  { value: "#FFEDD5", label: "Cream" },
  { value: "#D0EAFF", label: "Sky" },
  { value: "#DCEEE0", label: "Sage" },
  { value: "#E7DFF7", label: "Lilac" },
  { value: "#2A2F3A", label: "Midnight" },
  { value: "#141821", label: "Ink" },
] as const;

/**
 * Curated gradient set. Diagonal 135° so light hits the top-left,
 * matching how the sunset-linear brand gradient already reads across
 * the app. Mix of warm brand-adjacent gradients, cool naturals, and
 * dark options that pair with the dark theme. Two multi-stop
 * gradients (Sunset, Aurora) for boards that want more visual weight.
 */
const CANVAS_GRADIENTS = [
  { value: "linear-gradient(135deg, #FF5E1A 0%, #F0A64A 55%, #FFC58C 100%)", label: "Sunset" },
  { value: "linear-gradient(135deg, #FF8A65 0%, #FFB088 100%)",              label: "Peach" },
  { value: "linear-gradient(135deg, #E8A5B7 0%, #F5CFDA 100%)",              label: "Rose" },
  { value: "linear-gradient(135deg, #A390D4 0%, #D6C4F5 100%)",              label: "Lilac" },
  { value: "linear-gradient(135deg, #6DA4C9 0%, #C7DFF3 100%)",              label: "Sky" },
  { value: "linear-gradient(135deg, #6BA88C 0%, #C5E4CE 100%)",              label: "Mint" },
  { value: "linear-gradient(135deg, #F0B450 0%, #F7DBAA 100%)",              label: "Wheat" },
  { value: "linear-gradient(135deg, #3B82F6 0%, #A855F7 50%, #EC4899 100%)", label: "Aurora" },
  { value: "linear-gradient(135deg, #1E293B 0%, #334155 100%)",              label: "Midnight" },
  { value: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",              label: "Obsidian" },
  { value: "linear-gradient(135deg, #14532D 0%, #22543D 100%)",              label: "Forest" },
  { value: "linear-gradient(135deg, #4A1C15 0%, #7B2E1E 100%)",              label: "Wine" },
] as const;

export function BoardMenu({ board, shareCandidates, onRename, onSetAccent, onSetTheme, onSetCanvas, onArchive, onDelete, onShare }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("root");
  const [renameDraft, setRenameDraft] = useState(board.name);
  const renameRef = useRef<HTMLInputElement>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode("root");
      setRenameDraft(board.name);
      setShareError(null);
    }
  }, [open, board.name]);

  useEffect(() => {
    if (mode === "rename") {
      requestAnimationFrame(() => {
        renameRef.current?.focus();
        renameRef.current?.select();
      });
    }
  }, [mode]);

  function commitRename() {
    const t = renameDraft.trim();
    if (t && t !== board.name) onRename(t);
    setOpen(false);
  }

  function fireArchive() {
    onArchive();
    setOpen(false);
  }

  function fireDelete() {
    onDelete();
    setOpen(false);
  }

  async function submitShare(userId: string) {
    if (shareBusy) return;
    setShareError(null);
    setShareBusy(true);
    try {
      await onShare(userId);
      setOpen(false);
    } catch (err) {
      setShareError(
        err instanceof Error ? err.message : "Couldn't share this board.",
      );
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="grid h-7 w-7 place-items-center rounded-full text-ink-mute hover:bg-neutral-100 hover:text-ink-hi transition-colors outline-none focus-visible:ring-2 focus-visible:ring-helios-500/50"
          aria-label="Board settings"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-[60] w-72 rounded-[10px] surface-modal p-1.5 shadow-modal"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {mode === "root" && (
            <>
              <MenuItem
                icon={<Pencil className="h-3.5 w-3.5" />}
                onClick={() => setMode("rename")}
              >
                Rename board
              </MenuItem>
              <MenuItem
                icon={<Palette className="h-3.5 w-3.5" />}
                onClick={() => setMode("accent")}
              >
                Change accent
              </MenuItem>
              <MenuItem
                icon={<Paintbrush className="h-3.5 w-3.5" />}
                onClick={() => setMode("canvas")}
              >
                Theme & background
              </MenuItem>
              <MenuItem
                icon={<UserPlus className="h-3.5 w-3.5" />}
                onClick={() => setMode("share")}
              >
                Share board
              </MenuItem>
              <Divider />
              <MenuItem
                icon={<Archive className="h-3.5 w-3.5" />}
                onClick={fireArchive}
              >
                Archive board
              </MenuItem>
              <MenuItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setMode("confirm-delete")}
                danger
              >
                Delete board
              </MenuItem>
            </>
          )}

          {mode === "share" && (
            <div className="p-2">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                Share board
              </div>
              <p className="mb-2.5 text-[11px] leading-[1.4] text-ink-mute">
                Add someone from Helios Hub. They’ll get every board in this workspace.
              </p>
              <UserLookup
                users={shareCandidates}
                busy={shareBusy}
                placeholder="Search people"
                emptyLabel="Everyone on Helios Hub already has this workspace."
                onSelect={(user) => void submitShare(user.id)}
              />
              {shareError && (
                <div className="mt-2 text-[11.5px] text-danger">
                  {shareError}
                </div>
              )}
              <button
                onClick={() => setMode("root")}
                className="mt-2 w-full rounded-[6px] px-2 py-1.5 text-[12.5px] text-ink-mid hover:bg-neutral-50"
              >
                Back
              </button>
            </div>
          )}

          {mode === "rename" && (
            <div className="p-2">
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                Rename board
              </div>
              <input
                ref={renameRef}
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  }
                  if (e.key === "Escape") setMode("root");
                }}
                className="mb-2 w-full rounded-[6px] border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-[13px] text-ink-hi outline-none focus:border-helios-500/60"
              />
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setMode("root")}
                  className="flex-1 rounded-[6px] px-2 py-1.5 text-[12.5px] text-ink-mid hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  onClick={commitRename}
                  disabled={!renameDraft.trim() || renameDraft.trim() === board.name}
                  className="flex-1 rounded-[6px] bg-helios-500 px-2 py-1.5 text-[12.5px] font-medium text-white hover:bg-helios-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {mode === "accent" && (
            <div className="p-2">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
                Board accent
              </div>
              <div className="flex gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a.value}
                    onClick={() => {
                      onSetAccent(a.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-full text-white transition-transform hover:scale-110",
                      board.accent === a.value &&
                        "ring-2 ring-offset-2 ring-offset-white ring-ink-hi",
                    )}
                    style={{ background: a.value }}
                    aria-label={a.label}
                    title={a.label}
                  >
                    {board.accent === a.value && (
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setMode("root")}
                className="mt-2 w-full rounded-[6px] px-2 py-1.5 text-[12.5px] text-ink-mid hover:bg-neutral-50"
              >
                Back
              </button>
            </div>
          )}

          {mode === "canvas" && (
            <CanvasMode
              board={board}
              onSetTheme={onSetTheme}
              onSetCanvas={onSetCanvas}
              onBack={() => setMode("root")}
            />
          )}

          {mode === "confirm-delete" && (
            <div className="p-2">
              <div className="mb-1 text-[13px] font-semibold text-ink-hi">
                Delete “{board.name}”?
              </div>
              <p className="mb-2.5 text-[12px] leading-[1.4] text-ink-mid">
                This permanently removes the board, all its lists, cards, comments, and activity. This can’t be undone.
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setMode("root")}
                  className="flex-1 rounded-[6px] px-2 py-1.5 text-[12.5px] text-ink-mid hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  onClick={fireDelete}
                  className="flex-1 rounded-[6px] bg-danger px-2 py-1.5 text-[12.5px] font-medium text-white hover:bg-danger/90"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[13px] transition-colors",
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-ink-mid hover:bg-neutral-50 hover:text-ink-hi",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-neutral-100" />;
}

/* ─── Theme & canvas mode ───────────────────────────────────────
   Kept as its own subcomponent because the color-picker sub-popover
   needs its own state and the surrounding BoardMenu is already busy
   with rename / share / delete drafts. Isolating this keeps each mode
   readable and avoids state cross-contamination. */
function CanvasMode({
  board,
  onSetTheme,
  onSetCanvas,
  onBack,
}: {
  board: Board;
  onSetTheme: (theme: "light" | "dark") => void;
  onSetCanvas: (canvas: string | null) => void;
  onBack: () => void;
}) {
  const currentTheme = board.theme === "dark" ? "dark" : "light";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hex, setHex] = useState(board.canvas ?? "#FF5E1A");

  // A canvas value is "custom" when it matches neither a solid preset
  // nor a gradient preset. That's what lights up the color-picker chip.
  const canvasLower = (board.canvas ?? "").toLowerCase();
  const isSolidPresetActive = CANVAS_PRESETS.some(
    (p) => p.value.toLowerCase() === canvasLower,
  );
  const isGradientPresetActive = CANVAS_GRADIENTS.some(
    (g) => g.value.toLowerCase() === canvasLower,
  );
  const customActive =
    !!board.canvas && !isSolidPresetActive && !isGradientPresetActive;

  function commitHex(next: string) {
    setHex(next);
    if (/^#[0-9a-fA-F]{6}$/.test(next)) onSetCanvas(next);
  }

  return (
    <div className="p-2">
      <div className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
        Theme
      </div>
      <div
        className="mb-4 flex rounded-[8px] border border-neutral-200 bg-neutral-50 p-0.5"
        role="tablist"
      >
        {(
          [
            { value: "light", label: "Light", icon: Sun },
            { value: "dark", label: "Dark", icon: Moon },
          ] as const
        ).map((opt) => {
          const active = opt.value === currentTheme;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSetTheme(opt.value)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[12px] font-medium transition-colors",
                active
                  ? "bg-white text-ink-hi shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                  : "text-ink-mute hover:text-ink-mid",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
          Solid
        </span>
        {board.canvas && (
          <button
            type="button"
            onClick={() => {
              onSetCanvas(null);
              setHex("#FF5E1A");
            }}
            className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10.5px] text-ink-mute transition-colors hover:bg-neutral-100 hover:text-ink-hi"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            Reset
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-6 gap-1.5">
        {CANVAS_PRESETS.map((p) => {
          const active = board.canvas === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onSetCanvas(p.value)}
              className={cn(
                "relative grid aspect-square place-items-center rounded-[6px] outline-none transition-all",
                "ring-1 ring-inset ring-black/[0.06]",
                "hover:scale-[1.06]",
                active && "ring-2 ring-helios-500 ring-offset-1 ring-offset-white",
              )}
              style={{ background: p.value }}
              aria-label={p.label}
              title={p.label}
            >
              {active && (
                <Check
                  className={cn(
                    "h-3 w-3",
                    isLightHex(p.value) ? "text-ink-hi" : "text-white",
                  )}
                  strokeWidth={3}
                />
              )}
            </button>
          );
        })}

        {/* Custom color trigger — the 7th swatch in the grid. Rainbow
            conic when unused so it visually reads as "any color";
            fills with the picked hex once the user has one. */}
        <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={cn(
                "relative grid aspect-square place-items-center overflow-hidden rounded-[6px] outline-none transition-all",
                "ring-1 ring-inset ring-black/[0.06]",
                "hover:scale-[1.06]",
                customActive && "ring-2 ring-helios-500 ring-offset-1 ring-offset-white",
              )}
              style={{
                background: customActive
                  ? board.canvas ?? "#FF5E1A"
                  : "conic-gradient(from 180deg at 50% 50%, #FF5E1A, #F0A64A, #138510, #0079BF, #C377E0, #EB5A46, #FF5E1A)",
              }}
              aria-label="Custom color"
              title="Custom color"
            >
              <Pipette
                className={cn(
                  "h-3 w-3 drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]",
                  customActive && isLightHex(board.canvas!) ? "text-ink-hi" : "text-white",
                )}
                strokeWidth={2.5}
              />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="right"
              align="start"
              sideOffset={10}
              className="z-[70] rounded-[10px] surface-modal p-3 shadow-modal outline-none focus-visible:ring-2 focus-visible:ring-helios-500/40"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="w-[188px]">
                <HexColorPicker
                  color={board.canvas ?? hex}
                  onChange={(c) => {
                    setHex(c);
                    onSetCanvas(c);
                  }}
                  style={{ width: 188, height: 128 }}
                />
                <div className="mt-2.5 flex items-center gap-2">
                  <div
                    className="h-6 w-6 shrink-0 rounded-[4px] ring-1 ring-inset ring-black/[0.08]"
                    style={{ background: board.canvas ?? hex }}
                    aria-hidden
                  />
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11.5px] font-semibold text-ink-mute">
                      #
                    </span>
                    <input
                      value={(hex.replace(/^#/, "")).toUpperCase()}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                        commitHex(`#${raw}`);
                      }}
                      spellCheck={false}
                      maxLength={6}
                      className="h-6 w-full rounded-[4px] border border-neutral-200 bg-neutral-50 pl-5 pr-2 text-[11.5px] font-medium uppercase tabular-nums text-ink-hi outline-none transition-colors focus:border-helios-500/60 focus:bg-white"
                      aria-label="Hex color"
                    />
                  </div>
                </div>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <div className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
        Gradient
      </div>
      <div className="mb-3 grid grid-cols-6 gap-1.5">
        {CANVAS_GRADIENTS.map((g) => {
          const active =
            (board.canvas ?? "").toLowerCase() === g.value.toLowerCase();
          return (
            <button
              key={g.label}
              type="button"
              onClick={() => onSetCanvas(g.value)}
              className={cn(
                "relative grid aspect-square place-items-center overflow-hidden rounded-[6px] outline-none transition-all",
                "ring-1 ring-inset ring-black/[0.06]",
                "hover:scale-[1.06]",
                active && "ring-2 ring-helios-500 ring-offset-1 ring-offset-white",
              )}
              style={{ background: g.value }}
              aria-label={g.label}
              title={g.label}
            >
              {active && (
                <Check
                  className="h-3 w-3 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]"
                  strokeWidth={3}
                />
              )}
            </button>
          );
        })}
      </div>

      <button
        onClick={onBack}
        className="mt-1 w-full rounded-[6px] px-2 py-1.5 text-[12.5px] text-ink-mute transition-colors hover:bg-neutral-50 hover:text-ink-hi"
      >
        Back
      </button>
    </div>
  );
}

// Rough perceived-brightness gate — for a picked swatch we want the
// checkmark contrast to flip so it stays visible on both light and
// dark colors.
function isLightHex(hex: string): boolean {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return true;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}
