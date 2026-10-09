import type { Vertical } from '@/lib/social-hub/types';

/**
 * The user-action layer (unification Move 6A, D47): what a person can do to a
 * post from the hub, the same verbs for every content type. A target is
 * the post's refs (lib/social-hub/types.ts HubPost.refs); each type's
 * implementation calls that type's own functions, so its rules stay in one
 * place. A verb a type doesn't support is left out (the hub links to the
 * type's own page instead).
 */
export type ActionTarget = Readonly<Record<string, string>>;

export type ActionOutcome = { ok: boolean; note: string; status?: number };

/** `place` and `reschedule` put content on a chosen day and window (D50). */
export type ActionVerb = 'approve' | 'reject' | 'publishNow' | 'regenerate' | 'place' | 'reschedule';

/**
 * What a verb may carry besides its target: the day and window for `place`
 * and `reschedule`; a review's tags and note for `reject` (kept where the
 * type keeps a review: Explainers, D53).
 */
export type ActionInput = { nyDate?: string; slot?: string; tags?: readonly string[]; note?: string };

export type ActionFn = (target: ActionTarget, by: string, input?: ActionInput) => Promise<ActionOutcome>;

export type ContentActions = { vertical: Vertical } & Partial<Record<ActionVerb, ActionFn>>;

/** A ref the verb needs, or a 400 the route returns. */
export function need(target: ActionTarget, key: string): string {
  const value = target[key];
  if (!value) throw Object.assign(new Error(`Missing ${key}.`), { status: 400 });
  return value;
}

/** The day and window a placement verb needs, or a 400. */
export function needPlacement(input: ActionInput | undefined): { nyDate: string; slot: string } {
  if (!input?.nyDate || !input.slot) throw Object.assign(new Error('Missing nyDate or slot.'), { status: 400 });
  return { nyDate: input.nyDate, slot: input.slot };
}
