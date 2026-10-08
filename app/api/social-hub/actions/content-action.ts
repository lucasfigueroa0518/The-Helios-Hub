import type { ActionTarget, ActionVerb, ContentActions } from '@/lib/publishing/actions/types';
import { isUuid, type ActionSpec } from '@/lib/social-hub/action-route';
import type { ActionFlag } from '@/lib/social-hub/flags';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * Every hub action route is this one handler (D47): parse the post's target,
 * then call the type's verb in the user-action layer (lib/publishing/actions).
 * Bodies: `{ vertical, refs: { … } }` (every value a uuid), or a route's older
 * body (`legacy`), which maps to the same target.
 */
export type Parsed = { vertical: Vertical; target: ActionTarget };

const VERTICALS: readonly Vertical[] = ['carousels', 'explainers', 'reels', 'stories'];

export function parseTarget(body: unknown, allowed: readonly Vertical[] = VERTICALS): Parsed | null {
  const b = body as { vertical?: unknown; refs?: unknown } | null;
  if (!b || !allowed.includes(b.vertical as Vertical) || !b.refs || typeof b.refs !== 'object') return null;
  const entries = Object.entries(b.refs as Record<string, unknown>);
  if (entries.length === 0 || !entries.every(([, v]) => isUuid(v))) return null;
  return { vertical: b.vertical as Vertical, target: Object.fromEntries(entries) as ActionTarget };
}

export function contentAction(opts: {
  flag: ActionFlag;
  verb: ActionVerb;
  actions: () => Promise<Record<Vertical, ContentActions>>;
  allowed?: readonly Vertical[];
  legacy?: (body: unknown) => Parsed | null;
}): ActionSpec<Parsed> {
  return {
    flag: opts.flag,
    parse: (body) => parseTarget(body, opts.allowed) ?? opts.legacy?.(body) ?? null,
    run: async ({ vertical, target }, ctx) => {
      const verb = (await opts.actions())[vertical][opts.verb];
      if (!verb) return { ok: false, note: `${vertical} has no ${opts.verb} here; use its own page.`, status: 409 };
      return verb(target, ctx.email);
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
