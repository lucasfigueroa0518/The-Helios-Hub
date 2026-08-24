"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import {
  X,
  User as UserIcon,
  Tag,
  Calendar,
  CheckSquare,
  ArrowRight,
  Eye,
  EyeOff,
  Send,
  Check,
  Link as LinkIcon,
  ExternalLink,
} from "lucide-react";
import { cn, dueState, formatDate, timeAgo } from "@/lib/trello/utils";
import { Avatar } from "@/components/trello/ui/Avatar";
import { ChecklistBlock } from "@/components/trello/card/ChecklistBlock";
import { RailShell, RailSection } from "@/components/trello/card/rail/RailShell";
import { RailButton } from "@/components/trello/card/rail/RailButton";
import { MembersPicker } from "@/components/trello/card/rail/pickers/MembersPicker";
import { LabelsPicker } from "@/components/trello/card/rail/pickers/LabelsPicker";
import { DatesPicker } from "@/components/trello/card/rail/pickers/DatesPicker";
import { AddChecklistPicker } from "@/components/trello/card/rail/pickers/AddChecklistPicker";
import { AttachmentPicker } from "@/components/trello/card/rail/pickers/AttachmentPicker";
import { CopyAction } from "@/components/trello/card/rail/actions/CopyAction";
import { ArchiveAction } from "@/components/trello/card/rail/actions/ArchiveAction";
import type { Board, Card, List, User } from "@/lib/trello/types";

type Props = {
  card: Card;
  board: Board;
  list: List;
  users: User[];
  onClose: () => void;
  onUpdate: (patch: Partial<Card>) => void;
  onToggleAssignee: (userId: string) => void;
  onToggleLabel: (labelId: string) => void;
  onToggleComplete: () => void;
  onToggleChecklistItem: (checklistId: string, itemId: string) => void;
  onAddChecklistItem: (checklistId: string, text: string) => void;
  onDeleteChecklistItem: (checklistId: string, itemId: string) => void;
  onAddChecklist: (title: string) => void;
  onAddComment: (body: string) => void;
  onCopy: () => void;
  onArchive: () => void;
  onToggleTracker: () => void;
  isTracking: boolean;
  onAddLink: (url: string, title: string) => void;
  onCreateLabel: (name: string, color: string) => void;
  onRenameLabel: (labelId: string, name: string) => void;
  onDeleteLabel: (labelId: string) => void;
  onDeleteAttachment: (attachmentId: string) => void;
};

export function CardDetail({
  card,
  board,
  list,
  users,
  onClose,
  onUpdate,
  onToggleAssignee,
  onToggleLabel,
  onToggleComplete,
  onToggleChecklistItem,
  onAddChecklistItem,
  onDeleteChecklistItem,
  onAddChecklist,
  onAddComment,
  onCopy,
  onArchive,
  onToggleTracker,
  isTracking,
  onAddLink,
  onDeleteAttachment,
  onCreateLabel,
  onRenameLabel,
  onDeleteLabel,
}: Props) {
  const assignees = card.assigneeIds
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is User => !!u);
  const labels = card.labelIds
    .map((id) => board.labels.find((l) => l.id === id))
    .filter((l): l is NonNullable<typeof l> => !!l);
  const createdBy = users.find((u) => u.id === card.createdById);
  const dstate = dueState(card.due, card.complete);

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
          />
        </Dialog.Overlay>
        <Dialog.Content
          asChild
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="pointer-events-none fixed inset-0 z-50 grid place-items-stretch p-0 sm:place-items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "pointer-events-auto flex flex-col overflow-hidden surface-modal shadow-modal",
              // Mobile: full-screen sheet — no rounded corners, no
              // margins, use every viewport pixel. Above sm the modal
              // recovers its floating desktop shape.
              "h-full w-full rounded-none sm:h-auto sm:max-h-[88vh] sm:w-[min(880px,92vw)] sm:rounded-[14px]",
            )}
          >
            <Dialog.Title className="sr-only">{card.title}</Dialog.Title>

            {/* Top strip — eyebrow (board › list) → title → labels → close. */}
            <div className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-neutral-100 bg-white px-4 py-3 dark:border-white/10 dark:bg-neutral-950 sm:static sm:border-0 sm:bg-transparent sm:px-8 sm:pb-3 sm:pt-7">
              <div className="min-w-0 flex-1">
                <div className="eyebrow eyebrow-ink flex items-center gap-2 opacity-70">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-[2px]"
                    style={{ background: board.accent }}
                  />
                  <span>{board.name}</span>
                  <ArrowRight className="h-2.5 w-2.5" />
                  <span>{list.name}</span>
                </div>
                <TitleEditor
                  value={card.title}
                  onSave={(t) => onUpdate({ title: t })}
                />
                {(labels.length > 0 || createdBy) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {labels.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {labels.map((l) => (
                          <span
                            key={l.id}
                            className="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white"
                            style={{ background: l.color }}
                          >
                            {l.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {createdBy && (
                      <span className="text-[12px] text-ink-mute">
                        opened by {createdBy.name}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Dialog.Close asChild>
                <button
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-mid transition-colors hover:bg-neutral-100 hover:text-ink-hi dark:hover:bg-neutral-800"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </Dialog.Close>
            </div>

            {/* Asymmetric split on sm+; stacked column on mobile so
                the picker rail moves under the description instead of
                fighting the main pane for the 375px of horizontal
                space. Also collapses the horizontal padding down at
                mobile widths so the content isn't a narrow strip. */}
            <div className="flex min-h-0 flex-1 flex-col-reverse gap-4 overflow-hidden px-5 pb-5 pt-3 sm:flex-row sm:gap-8 sm:px-8 sm:pb-6">
              <div className="min-w-0 flex-1 overflow-y-auto sm:pr-2">
                {/* Chip row: members / labels / due */}
                <div className="flex flex-wrap items-start gap-x-6 gap-y-3 pb-5">
                  <ChipGroup label="Members">
                    <div className="flex items-center gap-1.5">
                      {assignees.length > 0 ? (
                        assignees.map((a) => (
                          <Avatar key={a.id} name={a.name} hue={a.hue} size="md" />
                        ))
                      ) : (
                        <span className="text-[12.5px] text-ink-mute">None</span>
                      )}
                      <MembersPicker
                        users={users}
                        selectedIds={card.assigneeIds}
                        onToggle={onToggleAssignee}
                      >
                        <button
                          type="button"
                          aria-label="Add member"
                          className="grid h-7 w-7 place-items-center rounded-full border border-dashed border-neutral-200 text-ink-mute transition-colors hover:border-neutral-300 hover:text-ink-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-helios-500/40"
                        >
                          <UserIcon className="h-3 w-3" />
                        </button>
                      </MembersPicker>
                    </div>
                  </ChipGroup>
                  {card.due && (
                    <ChipGroup label="Due date">
                      <DatesPicker
                        due={card.due}
                        complete={card.complete}
                        onToggleComplete={onToggleComplete}
                        onClear={() => onUpdate({ due: null, complete: false })}
                        onChange={(iso) => onUpdate({ due: iso })}
                      >
                        <button
                          type="button"
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] font-medium transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-helios-500/40",
                            dstate === "overdue"
                              ? "bg-danger text-white shadow-[0_0_0_1px_rgba(226,58,58,0.4)]"
                              : dstate === "soon"
                                ? "bg-warning text-white"
                                : dstate === "complete"
                                  ? "bg-heliosGreen-600/12 text-heliosGreen-600"
                                  : "bg-neutral-50 text-ink-hi font-normal",
                          )}
                        >
                          {card.complete && (
                            <Check className="h-3 w-3" strokeWidth={3} />
                          )}
                          <Calendar className="h-3 w-3" />
                          {formatDate(card.due)}
                        </button>
                      </DatesPicker>
                    </ChipGroup>
                  )}
                </div>

                <Section title="Description">
                  <DescriptionEditor
                    value={card.description ?? ""}
                    onSave={(v) => onUpdate({ description: v })}
                  />
                </Section>

                {card.checklists.length > 0 && (
                  <div className="mt-8 flex flex-col gap-7">
                    {card.checklists.map((cl) => (
                      <ChecklistBlock
                        key={cl.id}
                        checklist={cl}
                        onToggle={(itemId) => onToggleChecklistItem(cl.id, itemId)}
                        onAdd={(text) => onAddChecklistItem(cl.id, text)}
                        onDelete={(itemId) =>
                          onDeleteChecklistItem(cl.id, itemId)
                        }
                      />
                    ))}
                  </div>
                )}

                {card.attachments.length > 0 && (
                  <Section title="Attachments" className="mt-8">
                    <div className="flex flex-wrap gap-2">
                      {card.attachments.map((a) => (
                        <AttachmentChip
                          key={a.id}
                          name={a.name}
                          mime={a.mime}
                          url={a.url}
                          onDelete={() => onDeleteAttachment(a.id)}
                        />
                      ))}
                    </div>
                  </Section>
                )}

                {/* Comments + Activity tabs */}
                <div className="mt-8">
                  <Tabs.Root defaultValue="comments">
                    <Tabs.List className="flex gap-4 border-b border-neutral-200">
                      <TabTrigger value="comments">
                        Comments
                        {card.comments.length > 0 && (
                          <span className="ml-1.5 text-[11px] tabular-nums text-ink-mute">
                            {card.comments.length}
                          </span>
                        )}
                      </TabTrigger>
                      <TabTrigger value="activity">
                        Activity
                        {card.activity.length > 0 && (
                          <span className="ml-1.5 text-[11px] tabular-nums text-ink-mute">
                            {card.activity.length}
                          </span>
                        )}
                      </TabTrigger>
                    </Tabs.List>
                    <Tabs.Content value="comments" className="pt-4">
                      <CommentComposer onSubmit={onAddComment} />
                      <ul className="mt-4 flex flex-col gap-4">
                        {card.comments.length === 0 && (
                          <li className="text-[12.5px] text-ink-mute">
                            No comments yet.
                          </li>
                        )}
                        {card.comments.map((cm) => {
                          const author = users.find((u) => u.id === cm.authorId);
                          return (
                            <li key={cm.id} className="flex gap-3">
                              <Avatar
                                name={author?.name ?? "?"}
                                hue={author?.hue ?? 22}
                                size="md"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                  <span className="text-[13px] font-semibold text-ink-hi">
                                    {author?.name ?? "Someone"}
                                  </span>
                                  <span className="text-[11px] text-ink-mute">
                                    {timeAgo(cm.at)}
                                  </span>
                                </div>
                                <div className="mt-1 rounded-[8px] bg-neutral-50 px-3 py-2 text-[13.5px] leading-[1.5] text-ink-mid whitespace-pre-wrap">
                                  {cm.body}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </Tabs.Content>
                    <Tabs.Content value="activity" className="pt-4">
                      <ul className="flex flex-col gap-3">
                        {card.activity.length === 0 && (
                          <li className="text-[12.5px] text-ink-mute">
                            Nothing to show yet.
                          </li>
                        )}
                        {card.activity
                          .slice()
                          .reverse()
                          .map((ac) => {
                            const author = users.find(
                              (u) => u.id === ac.authorId
                            );
                            return (
                              <li key={ac.id} className="flex items-baseline gap-2 text-[12.5px]">
                                <span className="text-ink-hi font-medium">
                                  {author?.name.split(" ")[0] ?? "Someone"}
                                </span>
                                <span className="text-ink-mid">{ac.detail}</span>
                                <span className="text-ink-mute">
                                  · {timeAgo(ac.at)}
                                </span>
                              </li>
                            );
                          })}
                      </ul>
                    </Tabs.Content>
                  </Tabs.Root>
                </div>
              </div>

              {/* Right rail — quiet */}
              <RailShell>
                <RailSection label="Add to card">
                  <MembersPicker
                    users={users}
                    selectedIds={card.assigneeIds}
                    onToggle={onToggleAssignee}
                  >
                    <RailButton icon={<UserIcon className="h-3.5 w-3.5" />}>
                      Members
                    </RailButton>
                  </MembersPicker>
                  <LabelsPicker
                    boardId={board.id}
                    labels={board.labels}
                    selectedIds={card.labelIds}
                    onToggle={onToggleLabel}
                    onCreate={onCreateLabel}
                    onRename={onRenameLabel}
                    onDelete={onDeleteLabel}
                  >
                    <RailButton icon={<Tag className="h-3.5 w-3.5" />}>
                      Labels
                    </RailButton>
                  </LabelsPicker>
                  <DatesPicker
                    due={card.due}
                    complete={card.complete}
                    onToggleComplete={onToggleComplete}
                    onClear={() => onUpdate({ due: null, complete: false })}
                    onChange={(iso) => onUpdate({ due: iso })}
                  >
                    <RailButton icon={<Calendar className="h-3.5 w-3.5" />}>
                      Dates
                    </RailButton>
                  </DatesPicker>
                  <AddChecklistPicker onAdd={onAddChecklist}>
                    <RailButton icon={<CheckSquare className="h-3.5 w-3.5" />}>
                      Checklist
                    </RailButton>
                  </AddChecklistPicker>
                  <AttachmentPicker onAdd={onAddLink}>
                    <RailButton icon={<LinkIcon className="h-3.5 w-3.5" />}>
                      Link
                    </RailButton>
                  </AttachmentPicker>
                </RailSection>

                <RailSection label="Actions">
                  <RailButton
                    icon={
                      isTracking ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )
                    }
                    onClick={onToggleTracker}
                    active={isTracking}
                  >
                    {isTracking ? "Tracking" : "Track"}
                  </RailButton>
                  <CopyAction onCopy={onCopy} />
                  <ArchiveAction onArchive={onArchive} />
                </RailSection>
              </RailShell>
            </div>
          </motion.div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ─── Title / Description editors ───────────────────────────────── */

function TitleEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  function commit() {
    const t = draft.trim();
    if (t && t !== value) onSave(t);
    else setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <textarea
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        onBlur={commit}
        rows={1}
        className="w-full resize-none rounded-[6px] border border-neutral-200 bg-neutral-50 px-2 py-1 text-[20px] font-semibold leading-[1.3] text-ink-hi outline-none focus:border-helios-500/60"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="block w-full rounded-[6px] px-2 py-1 -mx-2 text-left text-[20px] font-semibold leading-[1.3] text-ink-hi hover:bg-neutral-50"
    >
      {value}
    </button>
  );
}

function DescriptionEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  function commit() {
    if (draft !== value) onSave(draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
          rows={6}
          placeholder="Add a more detailed description…"
          className="w-full resize-y rounded-[8px] border border-neutral-200 bg-neutral-50 p-3 text-[16px] sm:text-[13.5px] leading-[1.55] text-ink-hi placeholder:text-ink-mute outline-none focus:border-helios-500/60"
        />
        <div className="flex gap-2">
          <button
            onClick={commit}
            className="rounded-[6px] bg-helios-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-helios-600"
          >
            Save
          </button>
          <button
            onClick={() => {
              setDraft(value);
              setEditing(false);
            }}
            className="rounded-[6px] px-2 py-1.5 text-[13px] text-ink-mid hover:bg-neutral-50 hover:text-ink-hi"
          >
            Cancel
          </button>
          <span className="ml-auto self-center text-[11px] text-ink-mute">
            ⌘↵ to save
          </span>
        </div>
      </div>
    );
  }

  if (!value) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full rounded-[10px] bg-neutral-50 px-4 py-6 text-left text-[13px] text-ink-mute hover:text-ink-mid transition-colors"
      >
        Add a more detailed description…
      </button>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="block w-full rounded-[10px] bg-neutral-50/50 px-4 py-3 text-left text-[13.5px] leading-[1.55] text-ink-mid hover:bg-neutral-50 whitespace-pre-wrap transition-colors"
    >
      {value}
    </button>
  );
}

/* ─── Sub-primitives ────────────────────────────────────────────── */

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-mute">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ChipGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
        {label}
      </span>
      {children}
    </div>
  );
}

function AttachmentChip({
  name,
  mime,
  url,
  onDelete,
}: {
  name: string;
  mime: string;
  url?: string;
  onDelete: () => void;
}) {
  const isLink = mime === "link";
  const color = isLink
    ? "#5B7185"
    : mime.includes("image") || mime === "png" || mime === "jpg"
      ? "#B9A2FF"
      : mime === "pdf"
        ? "#F87168"
        : mime === "figma"
          ? "#FF5E1A"
          : mime === "video"
            ? "#5CD5FF"
            : mime === "doc"
              ? "#579DFF"
              : mime === "sheet"
                ? "#33CF2D"
                : "#8A7A70";
  const ext = isLink
    ? "LINK"
    : (name.split(".").pop() || mime).slice(0, 4).toUpperCase();

  // When the chip has a URL, the whole thing is a link and the visual
  // affordance (icon + hover) shifts accordingly. The delete button is a
  // small × that only appears on hover to avoid noise in the row.
  const Wrapper: React.ElementType = isLink && url ? "a" : "div";
  const wrapperProps =
    isLink && url
      ? { href: url, target: "_blank", rel: "noopener noreferrer" }
      : {};

  return (
    <div className="group relative">
      <Wrapper
        {...wrapperProps}
        className={cn(
          "flex items-center gap-2.5 rounded-[8px] bg-neutral-50 px-3 py-2 pr-8",
          isLink && "hover:bg-neutral-100 transition-colors",
        )}
      >
        <span
          className="grid h-8 w-8 place-items-center rounded-[6px] text-[9px] font-bold text-white"
          style={{ background: color }}
        >
          {isLink ? <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.25} /> : ext}
        </span>
        <span className="max-w-[220px] truncate text-[12.5px] text-ink-mid">
          {name}
        </span>
      </Wrapper>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded-full text-ink-mute opacity-0 transition-opacity hover:bg-neutral-200 hover:text-ink-hi group-hover:opacity-100"
        aria-label="Remove attachment"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function TabTrigger({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return (
    <Tabs.Trigger
      value={value}
      className={cn(
        "relative -mb-px flex items-baseline border-b-2 border-transparent px-1 pb-2 text-[13px] font-medium text-ink-mid",
        "data-[state=active]:border-helios-500 data-[state=active]:text-ink-hi",
        "hover:text-ink-hi transition-colors"
      )}
    >
      {children}
    </Tabs.Trigger>
  );
}

/* ─── Comment composer ─────────────────────────────────────────── */

function CommentComposer({ onSubmit }: { onSubmit: (body: string) => void }) {
  const [body, setBody] = useState("");
  function submit() {
    const t = body.trim();
    if (!t) return;
    onSubmit(t);
    setBody("");
  }
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder="Write a comment…"
        className="w-full resize-none rounded-[8px] border border-neutral-200 bg-neutral-50 p-3 text-[16px] sm:text-[13.5px] leading-[1.5] text-ink-hi placeholder:text-ink-mute outline-none focus:border-neutral-200 focus:bg-neutral-50"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={!body.trim()}
          className="inline-flex items-center gap-1.5 rounded-[6px] bg-helios-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-helios-600 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Send className="h-3.5 w-3.5" />
          Send
        </button>
        <span className="text-[11px] text-ink-mute">⌘↵ to send</span>
      </div>
    </div>
  );
}

