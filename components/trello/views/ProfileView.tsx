"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ViewShell } from "./ViewShell";
import { Avatar } from "@/components/trello/ui/Avatar";
import { Button } from "@/components/trello/ui/Button";
import { cn, initials } from "@/lib/trello/utils";
import { HUE_PRESETS, type Availability, type UserProfile } from "@/lib/trello/types";
import type { Board, Card, List, User } from "@/lib/trello/types";
import type { ProfileEditPatch } from "@/lib/trello/useBoardState";
import {
  Bell,
  BellRing,
  Calendar,
  CheckCircle2,
  Clock,
  MessageSquare,
  Moon,
  Pencil,
  Star,
  StarOff,
  Sunrise,
} from "lucide-react";

/**
 * Personalized profile screen for the current user.
 *
 * Everything on this page reads from `useBoardState` and writes back
 * through `updateProfile` / `toggleFavoriteBoard`. There's no backend
 * yet — state persists for the session, so refreshing the page resets
 * edits. When we wire a real store, only this hook's plumbing changes.
 *
 * Layout goes wide → narrow:
 *   • Hero (avatar, name, availability, timezone, edit)
 *   • Personalize (hue swatches, availability segmented control, notifications)
 *   • Bio (inline-editable tagline + longer bio)
 *   • Stats (4 tiles derived from `cards`)
 *   • Boards (favorite + touched boards)
 *   • Recent activity (this user's activity across all cards)
 */

type Props = {
  me: User;
  profile: UserProfile;
  cards: Card[];
  lists: List[];
  boards: Board[];
  favoriteBoardIds: string[];
  onUpdate: (patch: ProfileEditPatch) => void;
  onToggleFavoriteBoard: (boardId: string) => void;
  onOpenCard: (id: string) => void;
};

const cardSpring = { type: "spring" as const, stiffness: 460, damping: 32, mass: 0.6 };

const enter = (i: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: {
    delay: 0.04 + i * 0.05,
    type: "spring" as const,
    stiffness: 420,
    damping: 32,
  },
});

export function ProfileView({
  me,
  profile,
  cards,
  lists,
  boards,
  favoriteBoardIds,
  onUpdate,
  onToggleFavoriteBoard,
  onOpenCard,
}: Props) {
  const stats = useStats(cards, me.id);
  const touched = useMemo(() => {
    const set = new Set(cards.filter((c) => c.assigneeIds.includes(me.id)).map((c) => c.boardId));
    return boards.filter((b) => set.has(b.id));
  }, [cards, boards, me.id]);
  const recent = useRecentActivity(cards, me.id, 10);

  return (
    <ViewShell eyebrow="Profile" title={me.name}>
      <div className="mx-auto max-w-[880px] space-y-6">
        <motion.div {...enter(0)}>
          <HeroCard me={me} profile={profile} onUpdate={onUpdate} />
        </motion.div>

        <motion.div {...enter(1)} className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <PersonalizeCard me={me} profile={profile} onUpdate={onUpdate} />
          <BioCard profile={profile} onUpdate={onUpdate} />
        </motion.div>

        <motion.div {...enter(2)}>
          <StatsRow stats={stats} />
        </motion.div>

        {touched.length > 0 && (
          <motion.div {...enter(3)}>
            <SectionCard title="Boards you're on" hint="Star the ones you live in.">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {touched.map((b) => (
                  <BoardTile
                    key={b.id}
                    board={b}
                    starred={favoriteBoardIds.includes(b.id)}
                    cardCount={
                      cards.filter(
                        (c) =>
                          c.boardId === b.id && c.assigneeIds.includes(me.id)
                      ).length
                    }
                    onToggle={() => onToggleFavoriteBoard(b.id)}
                  />
                ))}
              </div>
            </SectionCard>
          </motion.div>
        )}

        {recent.length > 0 && (
          <motion.div {...enter(4)}>
            <SectionCard title="Your recent activity">
              <ol className="space-y-1">
                {recent.map((r) => {
                  const card = cards.find((c) => c.id === r.cardId);
                  const list = card ? lists.find((l) => l.id === card.listId) : null;
                  const board = card ? boards.find((b) => b.id === card.boardId) : null;
                  if (!card || !list || !board) return null;
                  return (
                    <li key={r.id}>
                      <button
                        onClick={() => onOpenCard(card.id)}
                        className="flex w-full items-start gap-3 rounded-[8px] px-2 py-2 text-left hover:bg-neutral-50"
                      >
                        <span className="mt-1 grid h-5 w-5 place-items-center rounded-full bg-neutral-50 text-ink-mute">
                          <VerbGlyph kind={r.kind} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] text-ink-mid">
                            <span className="font-medium text-ink-hi">{card.title}</span>
                            <span className="mx-1.5 text-ink-mute">·</span>
                            <span>{verbFor(r.kind)}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-mute">
                            <span className="h-1.5 w-1.5 rounded-sm" style={{ background: board.accent }} />
                            <span className="truncate">{board.name}</span>
                            <span className="text-ink-mute/60">›</span>
                            <span className="truncate">{list.name}</span>
                            <span className="text-ink-mute/60">·</span>
                            <span>{relTime(r.at)}</span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </SectionCard>
          </motion.div>
        )}
      </div>
    </ViewShell>
  );
}

/* ─────────────────────────────────────────────────────────────
   HERO
   ───────────────────────────────────────────────────────────── */

function HeroCard({
  me,
  profile,
  onUpdate,
}: {
  me: User;
  profile: UserProfile;
  onUpdate: (p: ProfileEditPatch) => void;
}) {
  const memberSince = useMemo(
    () => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(profile.joinedAt)),
    [profile.joinedAt]
  );

  const [editing, setEditing] = useState(false);
  const [draftFirst, setDraftFirst] = useState(me.firstName);
  const [draftLast, setDraftLast] = useState(me.lastName);
  const [draftRole, setDraftRole] = useState(me.role);
  const firstNameRef = useRef<HTMLInputElement>(null);

  // Reset drafts to authoritative values whenever we open the editor
  // (so a Cancel + reopen doesn't preserve abandoned edits).
  function openEdit() {
    setDraftFirst(me.firstName);
    setDraftLast(me.lastName);
    setDraftRole(me.role);
    setEditing(true);
    requestAnimationFrame(() => firstNameRef.current?.focus());
  }

  function save() {
    const first = draftFirst.trim();
    const last = draftLast.trim();
    const role = draftRole.trim();
    if (!first) {
      // First name is the only hard-required identity field.
      firstNameRef.current?.focus();
      return;
    }
    const patch: ProfileEditPatch = {};
    if (first !== me.firstName) patch.firstName = first;
    if (last !== me.lastName) patch.lastName = last;
    if (role !== me.role) patch.role = role;
    if (Object.keys(patch).length > 0) onUpdate(patch);
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
  }

  return (
    <div className="group relative overflow-hidden rounded-[18px] border border-neutral-200 bg-neutral-50">
      {/* Warm ambient wash tinted by the user's current hue. Fully
          decorative — the numeric hue is what drives it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background: `radial-gradient(60% 100% at 15% 20%, hsl(${me.hue} 60% 40% / 0.35) 0%, transparent 60%), radial-gradient(45% 80% at 85% 100%, hsl(${(me.hue + 30) % 360} 60% 45% / 0.22) 0%, transparent 65%)`,
        }}
      />

      {/* Edit trigger — quiet in the top-right corner, only shows on
          hover. Hidden while the editor is open. */}
      {!editing && (
        <button
          onClick={openEdit}
          className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white/70 px-2.5 py-1 text-[11.5px] text-ink-mid opacity-0 backdrop-blur-sm transition-opacity hover:text-ink-hi group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-helios-500/40"
          aria-label="Edit name and title"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
      )}

      <div className="relative flex items-center gap-6 p-7">
        <LargeAvatar name={me.name} hue={me.hue} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel>First name</FieldLabel>
                  <input
                    ref={firstNameRef}
                    value={draftFirst}
                    onChange={(e) => setDraftFirst(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        save();
                      }
                      if (e.key === "Escape") cancel();
                    }}
                    className="h-9 w-full rounded-[6px] border border-neutral-200 bg-neutral-50/90 px-2.5 text-[14px] text-ink-hi outline-none focus:border-helios-500/60 focus:bg-white"
                    placeholder="First"
                  />
                </div>
                <div>
                  <FieldLabel>Last name</FieldLabel>
                  <input
                    value={draftLast}
                    onChange={(e) => setDraftLast(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        save();
                      }
                      if (e.key === "Escape") cancel();
                    }}
                    className="h-9 w-full rounded-[6px] border border-neutral-200 bg-neutral-50/90 px-2.5 text-[14px] text-ink-hi outline-none focus:border-helios-500/60 focus:bg-white"
                    placeholder="Last"
                  />
                </div>
              </div>
              <div>
                <FieldLabel>Title</FieldLabel>
                <input
                  value={draftRole}
                  onChange={(e) => setDraftRole(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      save();
                    }
                    if (e.key === "Escape") cancel();
                  }}
                  className="h-9 w-full rounded-[6px] border border-neutral-200 bg-neutral-50/90 px-2.5 text-[14px] text-ink-hi outline-none focus:border-helios-500/60 focus:bg-white"
                  placeholder="What you do here"
                />
              </div>
              <div className="flex items-center justify-end gap-1.5 pt-1">
                <button
                  onClick={cancel}
                  className="rounded-[6px] px-3 py-1.5 text-[12.5px] text-ink-mid transition-colors hover:bg-neutral-100 hover:text-ink-hi"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={!draftFirst.trim()}
                  className="rounded-[6px] bg-helios-500 px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-helios-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <h2 className="font-display text-[24px] leading-none text-ink-hi">
                  {me.name}
                </h2>
                <AvailabilityPill value={profile.availability} />
              </div>
              <div className="mt-1.5 text-[13.5px] text-ink-mid">
                {me.role || (
                  <span className="italic text-ink-mute">Add your title</span>
                )}
                <span className="mx-2 text-ink-mute/60">·</span>
                <span className="text-ink-low">Member since {memberSince}</span>
              </div>
              {profile.tagline && (
                <p className="mt-3 max-w-[52ch] text-[14px] italic text-ink-mid">
                  &ldquo;{profile.tagline}&rdquo;
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-4 text-[12px] text-ink-low">
                <MetaChip icon={<Clock className="h-3.5 w-3.5" />} label={profile.timezone.replace(/_/g, " ").replace(/^.*\//, "")} />
                {profile.pronouns && (
                  <span className="text-ink-mute">{profile.pronouns}</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LargeAvatar({ name, hue }: { name: string; hue: number }) {
  const bg = `hsl(${hue} 55% 45%)`;
  const ring = `hsl(${hue} 70% 60% / 0.35)`;
  return (
    <motion.div
      // Subtle floaty entrance so the avatar reads as the anchor when
      // arriving on the page. Doesn't loop.
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={cardSpring}
      className="grid h-24 w-24 shrink-0 place-items-center rounded-full font-display text-[32px] text-white"
      style={{
        background: bg,
        boxShadow: `0 0 0 3px ${ring}, 0 12px 40px -8px hsl(${hue} 70% 40% / 0.5)`,
      }}
    >
      {initials(name)}
    </motion.div>
  );
}

function AvailabilityPill({ value }: { value: Availability }) {
  const cfg = {
    available: { label: "Available", dot: "bg-heliosGreen-400", text: "text-heliosGreen-300", pulse: true },
    away:      { label: "Away",       dot: "bg-neutral-300",         text: "text-ink-mute",         pulse: false },
  }[value];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px]",
        cfg.text
      )}
    >
      <span className="relative h-1.5 w-1.5">
        <span className={cn("absolute inset-0 rounded-full", cfg.dot)} />
        {cfg.pulse && (
          <motion.span
            className={cn("absolute inset-0 rounded-full", cfg.dot)}
            animate={{ scale: [1, 2.2, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
          />
        )}
      </span>
      {cfg.label}
    </span>
  );
}

function MetaChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-ink-mute">{icon}</span>
      <span>{label}</span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────
   PERSONALIZE
   ───────────────────────────────────────────────────────────── */

function PersonalizeCard({
  me,
  profile,
  onUpdate,
}: {
  me: User;
  profile: UserProfile;
  onUpdate: (p: ProfileEditPatch) => void;
}) {
  return (
    <SectionCard title="Personalize" hint="Everything here is you-only.">
      <div className="space-y-6">
        <div>
          <FieldLabel>Avatar color</FieldLabel>
          <HuePicker
            hue={me.hue}
            onChange={(hue) => onUpdate({ hue })}
          />
        </div>

        <div>
          <FieldLabel>Availability</FieldLabel>
          <SegmentedControl
            options={[
              { value: "available", label: "Available", icon: <Sunrise className="h-3.5 w-3.5" /> },
              { value: "away", label: "Away", icon: <Moon className="h-3.5 w-3.5" /> },
            ]}
            value={profile.availability}
            onChange={(v) => onUpdate({ availability: v as Availability })}
          />
        </div>

        <div>
          <FieldLabel>Notifications</FieldLabel>
          <div className="space-y-1.5">
            <NotifyToggle
              icon={<Bell className="h-3.5 w-3.5" />}
              label="Mentions"
              checked={profile.notify.mentions}
              onChange={(v) => onUpdate({ notify: { ...profile.notify, mentions: v } })}
            />
            <NotifyToggle
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              label="Assignments"
              checked={profile.notify.assignments}
              onChange={(v) => onUpdate({ notify: { ...profile.notify, assignments: v } })}
            />
            <NotifyToggle
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Due within 24h"
              checked={profile.notify.dueSoon}
              onChange={(v) => onUpdate({ notify: { ...profile.notify, dueSoon: v } })}
            />
            <NotifyToggle
              icon={<BellRing className="h-3.5 w-3.5" />}
              label="Daily digest"
              checked={profile.notify.dailyDigest}
              onChange={(v) => onUpdate({ notify: { ...profile.notify, dailyDigest: v } })}
            />
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function HuePicker({ hue, onChange }: { hue: number; onChange: (h: number) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {HUE_PRESETS.map((p) => (
          <motion.button
            key={p.hue}
            whileHover={{ y: -1, scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            transition={cardSpring}
            onClick={() => onChange(p.hue)}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-full text-[10px] font-medium text-white",
              hue === p.hue ? "ring-2 ring-neutral-400 ring-offset-2 ring-offset-surface-1" : ""
            )}
            style={{ background: `hsl(${p.hue} 55% 45%)` }}
            aria-label={p.name}
            title={p.name}
          />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={359}
          value={hue}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-full outline-none"
          style={{
            background: "linear-gradient(90deg, hsl(0 60% 45%), hsl(60 60% 45%), hsl(120 60% 45%), hsl(180 60% 45%), hsl(240 60% 45%), hsl(300 60% 45%), hsl(360 60% 45%))",
          }}
        />
        <span className="w-10 text-right text-[11px] tabular-nums text-ink-mute">{hue}°</span>
      </div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="relative flex rounded-[8px] bg-neutral-50 p-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[12.5px] transition-colors",
              active ? "text-ink-hi" : "text-ink-low hover:text-ink-mid"
            )}
          >
            {active && (
              <motion.span
                layoutId="segmented-availability"
                className="absolute inset-0 rounded-[6px] bg-neutral-100"
                transition={cardSpring}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {opt.icon}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 w-full rounded-[6px] bg-neutral-50 px-2 text-[12.5px] text-ink-hi",
        "border border-transparent focus:border-neutral-200 focus:bg-neutral-100 outline-none"
      )}
    />
  );
}

function NotifyToggle({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-neutral-50"
    >
      <span className="text-ink-mute">{icon}</span>
      <span className="flex-1 text-[13px] text-ink-mid">{label}</span>
      <span
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-helios-500" : "bg-neutral-100"
        )}
        aria-checked={checked}
        role="switch"
      >
        <motion.span
          animate={{ x: checked ? 12 : 2 }}
          transition={cardSpring}
          className="inline-block h-3 w-3 rounded-full bg-white shadow-sm"
        />
      </span>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
   BIO (inline editable)
   ───────────────────────────────────────────────────────────── */

function BioCard({
  profile,
  onUpdate,
}: {
  profile: UserProfile;
  onUpdate: (p: ProfileEditPatch) => void;
}) {
  const [editingTag, setEditingTag] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [draftTag, setDraftTag] = useState(profile.tagline);
  const [draftBio, setDraftBio] = useState(profile.bio);

  return (
    <SectionCard title="About" hint="Inline — tap a field to edit.">
      <div className="space-y-5">
        <div>
          <FieldLabel>Tagline</FieldLabel>
          {editingTag ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={draftTag}
                onChange={(e) => setDraftTag(e.target.value)}
                placeholder="One-line about you…"
                className={cn(
                  "h-9 w-full rounded-[6px] bg-neutral-50 px-2.5 text-[13.5px] text-ink-hi",
                  "border border-neutral-200 focus:border-helios-500/50 focus:bg-neutral-100 outline-none"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onUpdate({ tagline: draftTag.trim() });
                    setEditingTag(false);
                  }
                  if (e.key === "Escape") {
                    setDraftTag(profile.tagline);
                    setEditingTag(false);
                  }
                }}
              />
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    setDraftTag(profile.tagline);
                    setEditingTag(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onUpdate({ tagline: draftTag.trim() });
                    setEditingTag(false);
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setDraftTag(profile.tagline);
                setEditingTag(true);
              }}
              className="group flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-neutral-50"
            >
              <span className={cn("flex-1 text-[13.5px]", profile.tagline ? "text-ink-mid italic" : "text-ink-mute")}>
                {profile.tagline || "Add a tagline"}
              </span>
              <Pencil className="h-3.5 w-3.5 text-ink-mute opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
        </div>

        <div>
          <FieldLabel>Bio</FieldLabel>
          {editingBio ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={draftBio}
                onChange={(e) => setDraftBio(e.target.value)}
                rows={4}
                placeholder="A little more about you, your working style, favorite categories…"
                className={cn(
                  "w-full resize-none rounded-[6px] bg-neutral-50 p-2.5 text-[13px] text-ink-hi",
                  "border border-neutral-200 focus:border-helios-500/50 focus:bg-neutral-100 outline-none"
                )}
              />
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    setDraftBio(profile.bio);
                    setEditingBio(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onUpdate({ bio: draftBio.trim() });
                    setEditingBio(false);
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setDraftBio(profile.bio);
                setEditingBio(true);
              }}
              className="group flex w-full items-start gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-neutral-50"
            >
              <span
                className={cn(
                  "flex-1 text-[13px] leading-relaxed",
                  profile.bio ? "text-ink-mid" : "text-ink-mute"
                )}
              >
                {profile.bio || "Write a bio"}
              </span>
              <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-mute opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────────────────────
   STATS
   ───────────────────────────────────────────────────────────── */

function useStats(cards: Card[], userId: string) {
  return useMemo(() => {
    const now = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(now.getDate() - 7);

    let open = 0;
    let doneThisWeek = 0;
    let commentsThisWeek = 0;
    let overdue = 0;

    for (const c of cards) {
      const mine = c.assigneeIds.includes(userId);
      if (mine && !c.complete) open++;
      if (mine && c.complete) {
        // Best-effort: use most recent "checked" activity by this user
        const last = [...c.activity].reverse().find((a) => a.authorId === userId && a.kind === "checked");
        if (last && new Date(last.at) >= weekAgo) doneThisWeek++;
      }
      if (mine && c.due && !c.complete) {
        if (new Date(c.due) < now) overdue++;
      }
      for (const cm of c.comments) {
        if (cm.authorId === userId && new Date(cm.at) >= weekAgo) commentsThisWeek++;
      }
    }
    return { open, doneThisWeek, commentsThisWeek, overdue };
  }, [cards, userId]);
}

function StatsRow({
  stats,
}: {
  stats: { open: number; doneThisWeek: number; commentsThisWeek: number; overdue: number };
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label="Open cards" value={stats.open} tint="helios" />
      <StatTile label="Done this week" value={stats.doneThisWeek} tint="green" />
      <StatTile label="Comments (7d)" value={stats.commentsThisWeek} tint="mute" />
      <StatTile label="Overdue" value={stats.overdue} tint={stats.overdue > 0 ? "red" : "mute"} />
    </div>
  );
}

function StatTile({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: "helios" | "green" | "red" | "mute";
}) {
  const num =
    tint === "helios"
      ? "text-helios-300"
      : tint === "green"
        ? "text-heliosGreen-400"
        : tint === "red"
          ? "text-red-300"
          : "text-ink-hi";
  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={cardSpring}
      className="rounded-[12px] border border-neutral-200 bg-neutral-50 px-4 py-3"
    >
      <div className={cn("font-display text-[26px] leading-none tabular-nums", num)}>
        {value}
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-mute">
        {label}
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────
   BOARDS + ACTIVITY
   ───────────────────────────────────────────────────────────── */

function BoardTile({
  board,
  starred,
  cardCount,
  onToggle,
}: {
  board: Board;
  starred: boolean;
  cardCount: number;
  onToggle: () => void;
}) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.985 }}
      transition={cardSpring}
      onClick={onToggle}
      className="group flex items-center gap-3 rounded-[10px] border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-left hover:border-neutral-300 hover:bg-neutral-50"
    >
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: board.accent }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-ink-hi">{board.name}</div>
        <div className="text-[11px] text-ink-mute">
          {cardCount} card{cardCount === 1 ? "" : "s"} assigned
        </div>
      </div>
      <motion.span
        animate={{ scale: starred ? 1.1 : 1, rotate: starred ? -8 : 0 }}
        transition={{ type: "spring", stiffness: 520, damping: 18 }}
        className={cn("shrink-0", starred ? "text-helios-400" : "text-ink-mute")}
      >
        {starred ? <Star className="h-4 w-4 fill-current" /> : <StarOff className="h-4 w-4" />}
      </motion.span>
    </motion.button>
  );
}

type ActivityRow = { id: string; kind: string; at: string; cardId: string };

function useRecentActivity(cards: Card[], userId: string, limit: number) {
  return useMemo<ActivityRow[]>(() => {
    const rows: ActivityRow[] = [];
    for (const c of cards) {
      for (const a of c.activity) {
        if (a.authorId !== userId) continue;
        rows.push({ id: `${c.id}:${a.id}`, kind: a.kind, at: a.at, cardId: c.id });
      }
      for (const cm of c.comments) {
        if (cm.authorId !== userId) continue;
        rows.push({ id: `${c.id}:${cm.id}`, kind: "commented", at: cm.at, cardId: c.id });
      }
    }
    rows.sort((a, b) => (a.at < b.at ? 1 : -1));
    return rows.slice(0, limit);
  }, [cards, userId, limit]);
}

function VerbGlyph({ kind }: { kind: string }) {
  const cls = "h-3 w-3";
  switch (kind) {
    case "created":   return <Pencil className={cls} />;
    case "moved":     return <Calendar className={cls} />;
    case "checked":   return <CheckCircle2 className={cls} />;
    case "commented": return <MessageSquare className={cls} />;
    default:          return <span className={cls} />;
  }
}

function verbFor(kind: string) {
  return kind === "created"
    ? "you created it"
    : kind === "moved"
      ? "you moved it"
      : kind === "checked"
        ? "you checked it off"
        : kind === "commented"
          ? "you commented"
          : "you updated it";
}

function relTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

/* ─────────────────────────────────────────────────────────────
   SHARED
   ───────────────────────────────────────────────────────────── */

function SectionCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[16px] border border-neutral-200 bg-neutral-50 p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-mid">
          {title}
        </h3>
        {hint && <span className="text-[11px] text-ink-mute">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-mute">
      {children}
    </div>
  );
}
