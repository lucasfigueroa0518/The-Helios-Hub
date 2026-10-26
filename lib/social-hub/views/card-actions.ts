import type { ActionFlag } from '@/lib/social-hub/flags';
import type { ActionPlan } from '@/lib/social-hub/house';
import { flagOf, type OfferedAction, type SlotChoice } from '@/lib/social-hub/views/actions';
import type { PostState, StateId } from '@/lib/social-hub/views/state';

/**
 * A Today's Content card's buttons (spec 2026-10-13 §2): a fixed list per
 * state, so the rows line up across the day. Built from the same plans as the
 * post page (lib/social-hub/house.ts actionsFor); this file only picks and
 * labels them for a card.
 */

type PostPlan = Extract<ActionPlan, { kind: 'post' }>;

export type CardActions = { primary: OfferedAction | null; grid: OfferedAction[] };

const APPROVE = new Set<PostPlan['action']>(['approveCarousel', 'approveTrialReel', 'approveContent']);
const NEEDS: ReadonlySet<StateId> = new Set(['needs_you', 'slot_booked', 'ready', 'approved']);
const BOOKED: ReadonlySet<StateId> = new Set(['scheduled', 'late']);

/** A type on the idea queue (pool standard, 2026-10-21): Approve, Regenerate, Archive, and nothing else on the card. */
const QUEUE_GRID: PostPlan['action'][] = ['hardRegenerate', 'archive'];

const GRID: Record<'needs' | 'booked' | 'failed', PostPlan['action'][]> = {
  needs: ['place', 'reschedule', 'hardPublish', 'hardRegenerate', 'reject'],
  booked: ['reschedule', 'unschedule', 'hardPublish', 'reject'],
  failed: ['place', 'hardRegenerate', 'reject'],
};

const LABEL: Partial<Record<PostPlan['action'], string>> = {
  place: 'Schedule',
  reschedule: 'Reschedule',
  unschedule: 'Unschedule',
  hardPublish: 'Post now',
  hardRegenerate: 'Regenerate',
  reject: 'Reject',
  archive: 'Archive',
};

const TITLE: Partial<Record<PostPlan['action'], string>> = {
  hardPublish: 'Post now?',
  hardRegenerate: 'Make a new version?',
  reject: 'Reject this post?',
  archive: 'Archive this post?',
};

/** AI Events' regenerate is Rebuild post (AE-04): the same post re-rendered from the week's pool. */
const rebuilds = (plan: PostPlan) => plan.action === 'hardRegenerate' && plan.body.vertical === 'ai_events';

/** Only what posts live, can't be undone here, or spends money asks first. */
const ASKS = new Set<PostPlan['action']>(['hardPublish', 'hardRegenerate', 'reject', 'archive']);

export function cardActions(state: PostState, plans: readonly ActionPlan[], enabled: Readonly<Record<ActionFlag, boolean>>, slots?: SlotChoice[]): CardActions {
  const group = NEEDS.has(state.id) ? 'needs' : BOOKED.has(state.id) ? 'booked' : state.id === 'failed' ? 'failed' : null;
  if (!group) return { primary: null, grid: [] };
  const usable = plans.filter((p): p is PostPlan => p.kind === 'post' && enabled[flagOf(p.action)]);
  const offered = (plan: PostPlan, label: string): OfferedAction => ({
    key: plan.action,
    label,
    plan: ASKS.has(plan.action) ? plan : { ...plan, confirm: undefined },
    disabled: plan.disabled,
    danger: plan.action === 'reject' || plan.action === 'archive',
    confirmTitle: rebuilds(plan) ? 'Rebuild this post?' : TITLE[plan.action] ?? null,
    ...(plan.pick === 'slot' && slots ? { slots } : {}),
  });
  let primary: OfferedAction | null = null;
  if (group === 'failed') {
    const p = usable.find((x) => x.action === 'hardPublish');
    primary = p ? offered(p, 'Try again') : null;
  } else if (group === 'needs' && state.id !== 'approved') {
    const p = usable.find((x) => APPROVE.has(x.action));
    primary = p ? offered(p, 'Approve') : null;
  }
  const queue = usable.some((p) => p.action === 'archive');
  const grid = (queue ? QUEUE_GRID : GRID[group])
    .filter((a) => !(group === 'failed' && a === 'hardPublish'))
    .flatMap((a) => {
      const p = usable.find((x) => x.action === a);
      // On a failed card, placing it again is a Reschedule (B7).
      return p ? [offered(p, group === 'failed' && a === 'place' ? 'Reschedule' : rebuilds(p) ? 'Rebuild post' : LABEL[a]!)] : [];
    });
  return { primary, grid };
}
