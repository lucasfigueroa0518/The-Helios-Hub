/**
 * The hook bank (AE-13, AE-23): the 8 approved cover lines, verbatim. Each post draws one at random,
 * never one the last HOOK_HISTORY posts used (modelled on the Explainers opener bank,
 * explainers/world-kit/openers/bank.js pickOpener). The draw is stored on the post and kept on a rebuild.
 *
 * `lit` is the line's final phrase: the cover lights it (solid stage orange with a glow, AE-15) on
 * its own last line or two. It is always the exact tail of `text`, so `lead + ' ' + lit === text`,
 * and short enough that the lit lines never outweigh the white ones at cover sizes.
 */

export type Hook = { readonly key: HookKey; readonly text: string; readonly lit: string };

const BANK = [
  { key: 'one_event', text: 'Your city has one AI event this week you shouldn’t skip.', lit: 'shouldn’t skip.' },
  { key: 'everyones_story', text: 'The AI events you’ll see on everyone’s story next week.', lit: 'everyone’s story next week.' },
  { key: 'rsvps_close', text: 'Where the AI crowd is going this week, before the RSVPs close.', lit: 'before the RSVPs close.' },
  { key: 'dragging_friend', text: 'Send this to the friend you’re dragging to an AI event.', lit: 'dragging to an AI event.' },
  { key: 'group_chat', text: 'The AI events your group chat should already be planning around.', lit: 'planning around.' },
  { key: 'find_your_city', text: 'Find your city. RSVP before it’s gone. →', lit: 'RSVP before it’s gone. →' },
  { key: 'week_planned', text: 'Your AI week, already planned. Swipe for your city.', lit: 'Swipe for your city.' },
  { key: 'best_this_week', text: 'Best AI networking events this week.', lit: 'this week.' },
] as const;

export type HookKey = (typeof BANK)[number]['key'];

export const HOOKS: readonly Hook[] = Object.freeze(BANK.map((h) => Object.freeze({ ...h })));
export const HOOK_KEYS: readonly HookKey[] = Object.freeze(HOOKS.map((h) => h.key));

/** How many of the latest posts' hooks the next post may not repeat (AE-13). */
export const HOOK_HISTORY = 4;

export const isHookKey = (key: unknown): key is HookKey => typeof key === 'string' && (HOOK_KEYS as readonly string[]).includes(key);

/** The bank entry for `key`, or null. */
export const hookByKey = (key: string): Hook | null => HOOKS.find((h) => h.key === key) ?? null;

/** The hook split for the cover: the white lead, then the lit final phrase. */
export function hookLines(hook: Hook): { lead: string; lit: string } {
  return { lead: hook.text.slice(0, hook.text.length - hook.lit.length).trimEnd(), lit: hook.lit };
}

/**
 * The next post's hook: a random one that none of the `recent` posts used (newest first; only the
 * first HOOK_HISTORY count). If every hook was used that recently, the one used longest ago (or never).
 * `rand` is Math.random's shape.
 */
export function pickHook(recentKeys: readonly string[] | null | undefined, { rand = Math.random, history = HOOK_HISTORY }: { rand?: () => number; history?: number } = {}): HookKey {
  const recent = recentKeys ?? [];
  const blocked = new Set(recent.slice(0, history));
  const free = HOOK_KEYS.filter((k) => !blocked.has(k));
  if (free.length) return free[Math.min(free.length - 1, Math.floor(rand() * free.length))]!;
  const lastUse = (k: HookKey) => (recent.includes(k) ? recent.indexOf(k) : Infinity);
  return HOOK_KEYS.reduce((best, k) => (lastUse(k) > lastUse(best) ? k : best));
}
