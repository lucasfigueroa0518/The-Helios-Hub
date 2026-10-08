import type { Vertical } from '@/lib/social-hub/types';

/**
 * The user-action layer (unification Move 6A, D47): what a person can do to a
 * post from the hub, the same four verbs for every content type. A target is
 * the post's refs (lib/social-hub/types.ts HubPost.refs); each type's
 * implementation calls that type's own functions, so its rules stay in one
 * place. A verb a type doesn't support is left out (the hub links to the
 * type's own page instead).
 */
export type ActionTarget = Readonly<Record<string, string>>;

export type ActionOutcome = { ok: boolean; note: string; status?: number };

export type ActionVerb = 'approve' | 'reject' | 'publishNow' | 'regenerate';

export type ContentActions = { vertical: Vertical } & Partial<Record<ActionVerb, (target: ActionTarget, by: string) => Promise<ActionOutcome>>>;

/** A ref the verb needs, or a 400 the route returns. */
export function need(target: ActionTarget, key: string): string {
  const value = target[key];
  if (!value) throw Object.assign(new Error(`Missing ${key}.`), { status: 400 });
  return value;
}
