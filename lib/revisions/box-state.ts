/**
 * Targeted Revisions: what the post view's revision box shows, from the item's revision rows.
 * Pure (no IO, type-only imports), so the browser component stays thin and every state is tested
 * (tests/revisions-box.test.ts). The read route sends `BoxRow`s (toBoxRow), newest first.
 */
import type { Vertical } from '@/lib/social-hub/types';

import { VERTICAL_LABELS } from './labels';
import type { FixKind, PartRef, RevisionRow, RevisionStatus } from './types';

/** The fields of a revision row the box needs; never the refs, who asked, before/after or the model's reading. */
export type BoxRow = {
  id: string;
  status: RevisionStatus;
  instruction: string;
  question: string | null;
  note: string | null;
  part: PartRef | null;
  fixKind: FixKind | null;
  stageTag: string | null;
  spendUsd: number;
  capUsd: number | null;
  ceilingUsd: number | null;
  overrideUsd: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  parentId: string | null;
  undoneAt: string | null;
};

export function toBoxRow(r: RevisionRow): BoxRow {
  return {
    id: r.id,
    status: r.status,
    instruction: r.instruction,
    question: r.question,
    note: r.note,
    part: r.part,
    fixKind: r.fixKind,
    stageTag: r.stageTag,
    spendUsd: r.spendUsd,
    capUsd: r.capUsd,
    ceilingUsd: r.ceilingUsd,
    overrideUsd: r.overrideUsd,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    parentId: r.parentId,
    undoneAt: r.undoneAt,
  };
}

/** Newest first: created time, then id (two rows in one millisecond keep a stable order). */
export function newestFirst<T extends { createdAt: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * The one ref each type's revision verbs read (`need(t, key)` in lib/publishing/actions/<type>.ts; a
 * test pins the two together). The box sends only this ref, so the log keeps the content's id, not
 * a slot's or an attempt's.
 */
export const REVISION_REF_KEY: Record<Vertical, string> = {
  carousels: 'postId',
  reels: 'videoJobId',
  explainers: 'jobId',
  stories: 'setId',
  last_few_days: 'lfdPostId',
  ai_events: 'aiEventsPostId',
};

/** The refs a post's revision box sends, or null when the post has no such ref (the box is not shown). */
export function revisionRefs(vertical: Vertical, refs: Readonly<Record<string, string>>): Record<string, string> | null {
  const key = REVISION_REF_KEY[vertical];
  const value = refs[key];
  return value ? { [key]: value } : null;
}

/** Why the box is disabled for this post, or null. Published (or posting) and rejected posts can't be revised. */
export function lockReason(post: { status: string; stateId?: string | null }): string | null {
  if (post.status === 'published' || post.status === 'publishing' || post.stateId === 'published') return 'Published posts can’t be revised.';
  if (post.stateId === 'rejected') return 'Rejected posts can’t be revised.';
  return null;
}

const STAGE_NAMES: Record<string, string> = { copy: 'the words', frame: 'the picture', video: 'the video', caption: 'the caption' };

/** A part in plain words: "slide 3", "frame 2", "the words". */
export function partLabel(part: PartRef): string {
  const kind = part.kind.replace(/_/g, ' ').trim();
  const key = part.key.replace(/_/g, ' ').trim();
  if (part.kind === 'stage') return STAGE_NAMES[part.key] ?? `the ${key}`;
  if (!key) return kind || 'this part';
  if (!kind) return key;
  return `${kind} ${key}`;
}

/** Signs of a raw error (an exception name, a code, a stack line, a JSON blob) a person must not be shown. */
const TECHNICAL = /\b(?:\w*Error|exception|ECONN\w*|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|undefined|null|NaN|stack|fetch failed|status code|errno|syscall)\b|[{}[\]<>`]|\bat \S+ \(|\bengine\b/i;

const FALLBACK: Partial<Record<RevisionStatus, string>> = {
  failed: 'The change couldn’t be made, so the original was kept. Try again, or say it a different way.',
  blocked: 'That change couldn’t pass the post’s checks, so nothing was changed. Try saying it a different way.',
  paused_at_cap: 'This change would cost more than its usual limit. Allow a higher amount to run it.',
  paused_at_ceiling: 'This change reached its spending limit and paused. Nothing was changed; you can keep going.',
};

/** The row's note as a person should read it: the engine's plain note, or a plain stand-in when it carries a raw error. */
export function plainNote(status: RevisionStatus, note: string | null): string {
  const text = note?.trim() ?? '';
  const sentBack = /The post was sent back to review and stays there\./.test(text) ? ' The post was sent back to review.' : '';
  if (text && /could not roll back|could not be logged or rolled back/i.test(text)) {
    return `The change failed and could not be fully undone, so the post may still show the revised version. Someone has been notified.${sentBack}`;
  }
  if (!text) return FALLBACK[status] ?? 'Something went wrong. Try again in a moment.';
  if (!TECHNICAL.test(text)) return text;
  return `${FALLBACK[status] ?? 'Something went wrong. Try again in a moment.'}${sentBack}`;
}

/** The dollar amounts in a note, in order ("$0.80" → 0.8). */
function amounts(note: string | null): number[] {
  return [...(note ?? '').matchAll(/\$\s?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * The amount the "Allow up to" control starts at: the estimate the paused-at-cap note names (its
 * first amount), else the cap; null when neither is known. A ceiling pause suggests nothing: the
 * person enters the amount themselves.
 */
export function suggestOverrideUsd(r: Pick<BoxRow, 'status' | 'note' | 'capUsd'>): number | null {
  if (r.status !== 'paused_at_cap') return null;
  const estimate = /estimated at/i.test(r.note ?? '') ? amounts(r.note)[0] : undefined;
  if (estimate) return estimate;
  return r.capUsd && r.capUsd > 0 ? r.capUsd : null;
}

function minutesAgo(since: string | null, now: Date): string {
  const t = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor((now.getTime() - t) / 60_000);
  if (mins < 1) return 'less than a minute ago';
  if (mins === 1) return '1 minute ago';
  if (mins < 90) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

export type Current =
  | { kind: 'revising'; id: string; instruction: string; queued: boolean; hint: string }
  | { kind: 'asking'; id: string; instruction: string; question: string; replyTo: string }
  | { kind: 'applied'; id: string; summary: string }
  | { kind: 'blocked' | 'failed'; id: string; note: string }
  | { kind: 'paused'; id: string; revisionId: string; at: 'cap' | 'ceiling'; note: string; suggestUsd: number | null; needsAmount: boolean; notified: boolean };

export type PartControl = {
  part: PartRef;
  label: string;
  /** Revisions of this part that are in place now. */
  applied: number;
  latest: { id: string; instruction: string };
  canUndo: boolean;
  /** More than one revision is in place: "Restore original" goes back past all of them at once. */
  canRestore: boolean;
};

export type BoxState = {
  /** Why the box is disabled (published, rejected), or null. */
  lock: string | null;
  /** The newest request, as the box shows it; null when there is none (or it was undone). */
  current: Current | null;
  /** Parts with revisions in place, newest change first: their Undo / Restore original. */
  parts: PartControl[];
  /** Ask the server again shortly: a request is queued or running. */
  polling: boolean;
  /** The main text area takes a new request. */
  canSubmit: boolean;
  /** The text area's prompt, with the type's own name. */
  prompt: string;
  /** One line for screen readers when the state changes. */
  announce: string;
};

const partKey = (p: PartRef) => `${p.kind}\u0000${p.key}`;

function currentOf(r: BoxRow, now: Date): Current | null {
  switch (r.status) {
    case 'requested':
    case 'running': {
      const ago = minutesAgo(r.startedAt ?? r.createdAt, now);
      const hint = r.status === 'requested'
        ? `Waiting to start${ago ? `, asked ${ago}` : ''}. You can close this and come back.`
        : `Started ${ago || 'just now'}. Most changes take a few minutes. You can close this and come back.`;
      return { kind: 'revising', id: r.id, instruction: r.instruction, queued: r.status === 'requested', hint };
    }
    case 'asking':
      return { kind: 'asking', id: r.id, instruction: r.instruction, question: r.question?.trim() || 'Can you say a bit more about what to change?', replyTo: r.id };
    case 'applied':
      return { kind: 'applied', id: r.id, summary: `Done: “${r.instruction}”${r.part ? ` (${partLabel(r.part)})` : ''}.` };
    case 'blocked':
    case 'failed':
      return { kind: r.status, id: r.id, note: plainNote(r.status, r.note) };
    case 'paused_at_cap':
    case 'paused_at_ceiling': {
      const at = r.status === 'paused_at_cap' ? 'cap' : 'ceiling';
      return { kind: 'paused', id: r.id, revisionId: r.id, at, note: plainNote(r.status, r.note), suggestUsd: suggestOverrideUsd(r), needsAmount: at === 'ceiling', notified: at === 'ceiling' };
    }
    default:
      return null;
  }
}

const ANNOUNCE: Record<Current['kind'], string> = {
  revising: 'Revising…',
  asking: 'A question about your change.',
  applied: 'Done. The change is in place.',
  blocked: 'The change was not made.',
  failed: 'The change was not made.',
  paused: 'The change is paused.',
};

export function revisionBoxState(rows: readonly BoxRow[], opts: { vertical: Vertical; lock?: string | null; now?: Date }): BoxState {
  const now = opts.now ?? new Date();
  const lock = opts.lock ?? null;
  const prompt = `Describe what’s off in this ${VERTICAL_LABELS[opts.vertical]} post, in your words.`;
  if (lock) return { lock, current: null, parts: [], polling: false, canSubmit: false, prompt, announce: lock };

  const sorted = newestFirst(rows);
  // An answered question is history: its reply row (newer) is what the box shows.
  const newest = sorted[0];
  const current = newest ? currentOf(newest, now) : null;

  const groups = new Map<string, BoxRow[]>();
  for (const r of sorted) {
    if (r.status !== 'applied' || !r.part) continue;
    const k = partKey(r.part);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const parts: PartControl[] = [...groups.values()].map((applied) => {
    const latest = applied[0]!;
    return {
      part: latest.part!,
      label: partLabel(latest.part!),
      applied: applied.length,
      latest: { id: latest.id, instruction: latest.instruction },
      canUndo: true,
      canRestore: applied.length > 1,
    };
  });

  const polling = current?.kind === 'revising';
  return {
    lock: null,
    current,
    parts,
    polling,
    canSubmit: current?.kind !== 'revising' && current?.kind !== 'asking',
    prompt,
    announce: current ? ANNOUNCE[current.kind] : '',
  };
}
