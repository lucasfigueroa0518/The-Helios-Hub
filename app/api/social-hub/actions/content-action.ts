import { FAILURE_TAGS } from '@/lib/explainers/types';
import type { ActionInput, ActionTarget, ActionVerb, ContentActions } from '@/lib/publishing/actions/types';
import { INSTRUCTION_MAX_CHARS } from '@/lib/revisions/types';
import { isUuid, type ActionSpec } from '@/lib/social-hub/action-route';
import type { ActionFlag } from '@/lib/social-hub/flags';
import { isDayKey } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * Every hub action route is this one handler (D47): parse the post's target,
 * then call the type's verb in the user-action layer (lib/publishing/actions).
 * Bodies: `{ vertical, refs: { … } }` (every value a uuid), optionally with a
 * review (`tags` from the Explainers review vocabulary, `note` ≤ 500
 * characters, D53), or a route's older body (`legacy`), which maps to the
 * same target. Placement routes also need `nyDate` and `slot` (D50).
 */
export type Parsed = { vertical: Vertical; target: ActionTarget; input?: ActionInput };

const VERTICALS: readonly Vertical[] = ['carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events', 'field_notes'];

/** The longest review note a hub action carries. */
export const NOTE_MAX_CHARS = 500;

/** The one flag both placement routes (place and reschedule) answer to (D50). */
export const RESCHEDULE_FLAG: ActionFlag = 'reschedule';

/** A review's optional tags and note; null when either is malformed. */
function parseReview(b: { tags?: unknown; note?: unknown }): Pick<ActionInput, 'tags' | 'note'> | null {
  const out: Pick<ActionInput, 'tags' | 'note'> = {};
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || !b.tags.every((t) => typeof t === 'string' && (FAILURE_TAGS as readonly string[]).includes(t))) return null;
    out.tags = [...new Set(b.tags as string[])];
  }
  if (b.note !== undefined) {
    if (typeof b.note !== 'string' || b.note.length > NOTE_MAX_CHARS) return null;
    out.note = b.note;
  }
  return out;
}

export function parseTarget(body: unknown, allowed: readonly Vertical[] = VERTICALS): Parsed | null {
  const b = body as { vertical?: unknown; refs?: unknown; tags?: unknown; note?: unknown } | null;
  if (!b || !allowed.includes(b.vertical as Vertical) || !b.refs || typeof b.refs !== 'object') return null;
  const entries = Object.entries(b.refs as Record<string, unknown>);
  if (entries.length === 0 || !entries.every(([, v]) => isUuid(v))) return null;
  const review = parseReview(b);
  if (!review) return null;
  return {
    vertical: b.vertical as Vertical,
    target: Object.fromEntries(entries) as ActionTarget,
    ...(Object.keys(review).length ? { input: review } : {}),
  };
}

/** A window id (`afternoon`, a Stories series) or, on the calendar's free times, a slot id (`t0780`, `t0510:morning_download`). */
const SLOT = /^(?:[a-z][a-z_]{0,39}|t[0-9]{4}(?::[a-z][a-z_]{0,39})?)$/;

/** `{ vertical, refs, nyDate: 'YYYY-MM-DD', slot }` (place and reschedule, D50). */
export function parsePlacement(body: unknown, allowed: readonly Vertical[] = VERTICALS): Parsed | null {
  const parsed = parseTarget(body, allowed);
  const b = body as { nyDate?: unknown; slot?: unknown } | null;
  if (!parsed || !isDayKey(b?.nyDate) || typeof b?.slot !== 'string' || !SLOT.test(b.slot)) return null;
  return { vertical: parsed.vertical, target: parsed.target, input: { nyDate: b.nyDate, slot: b.slot } };
}

/** A part's kind or key: a short word or number from the post's own parts list. */
const PART_FIELD = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A target without review fields, for the revision routes. */
function bareTarget(body: unknown, allowed?: readonly Vertical[]): Parsed | null {
  const parsed = parseTarget(body, allowed);
  return parsed ? { vertical: parsed.vertical, target: parsed.target } : null;
}

/**
 * `{ vertical, refs, instruction, parentId? }` (Targeted Revisions `revise`).
 * An empty instruction passes here so the verb answers it with a plain note (400).
 */
export function parseRevise(body: unknown, allowed?: readonly Vertical[]): Parsed | null {
  const parsed = bareTarget(body, allowed);
  const b = body as { instruction?: unknown; parentId?: unknown } | null;
  if (!parsed || typeof b?.instruction !== 'string' || b.instruction.length > INSTRUCTION_MAX_CHARS) return null;
  if (b.parentId !== undefined && !isUuid(b.parentId)) return null;
  return { ...parsed, input: { instruction: b.instruction, ...(b.parentId ? { parentId: b.parentId as string } : {}) } };
}

/** `{ vertical, refs, part: { kind, key }, original? }` (`undoRevision`; `original: true` restores the pipeline's original). */
export function parseUndoRevision(body: unknown, allowed?: readonly Vertical[]): Parsed | null {
  const parsed = bareTarget(body, allowed);
  const b = body as { part?: { kind?: unknown; key?: unknown } | null; original?: unknown } | null;
  const part = b?.part;
  if (!parsed || !part || typeof part !== 'object') return null;
  if (typeof part.kind !== 'string' || !PART_FIELD.test(part.kind) || typeof part.key !== 'string' || !PART_FIELD.test(part.key)) return null;
  if (b!.original !== undefined && typeof b!.original !== 'boolean') return null;
  return { ...parsed, input: { part: { kind: part.kind, key: part.key }, ...(b!.original ? { original: true } : {}) } };
}

/** `{ vertical, refs, revisionId, overrideUsd > 0 }` (`continueRevision`). */
export function parseContinueRevision(body: unknown, allowed?: readonly Vertical[]): Parsed | null {
  const parsed = bareTarget(body, allowed);
  const b = body as { revisionId?: unknown; overrideUsd?: unknown } | null;
  if (!parsed || !isUuid(b?.revisionId)) return null;
  const usd = b!.overrideUsd;
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return null;
  return { ...parsed, input: { revisionId: b!.revisionId as string, overrideUsd: usd } };
}

export function contentAction(opts: {
  flag: ActionFlag;
  verb: ActionVerb;
  actions: () => Promise<Record<Vertical, ContentActions>>;
  allowed?: readonly Vertical[];
  legacy?: (body: unknown) => Parsed | null;
  /** The body parser when the verb needs more than a target (placement). */
  parse?: (body: unknown, allowed?: readonly Vertical[]) => Parsed | null;
}): ActionSpec<Parsed> {
  const parse = opts.parse ?? parseTarget;
  const movesAPairedDay = opts.verb === 'place' || opts.verb === 'reschedule' || opts.verb === 'unschedule';
  return {
    flag: opts.flag,
    parse: (body) => parse(body, opts.allowed) ?? opts.legacy?.(body) ?? null,
    // Carousels and Last Few Days share days. Moving one can change the other, so those actions refresh both.
    scope: ({ vertical }) => (movesAPairedDay && (vertical === 'carousels' || vertical === 'last_few_days') ? null : vertical),
    run: async ({ vertical, target, input }, ctx) => {
      const verb = (await opts.actions())[vertical][opts.verb];
      if (!verb) return { ok: false, note: `${vertical} has no ${opts.verb} here; use its own page.`, status: 409 };
      return verb(target, ctx.email, input);
    },
  };
}

/** `{ vertical, ref }` bodies (Hard publish / Hard regenerate): the ref each type's verb reads. */
export function refBody(keys: Partial<Record<Vertical, string>>): (body: unknown) => Parsed | null {
  return (body) => {
    const b = body as { vertical?: unknown; ref?: unknown } | null;
    const key = keys[b?.vertical as Vertical];
    if (!key || !isUuid(b?.ref)) return null;
    return { vertical: b!.vertical as Vertical, target: { [key]: b!.ref as string } };
  };
}
