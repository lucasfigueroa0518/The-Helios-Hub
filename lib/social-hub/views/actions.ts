import type { ActionFlag } from '@/lib/social-hub/flags';
import type { ActionPlan } from '@/lib/social-hub/house';
import { verticalInfo } from '@/lib/social-hub/verticals';
import type { PostState } from '@/lib/social-hub/views/state';
import type { HubPost } from '@/lib/social-hub/types';

/**
 * What a person can do with a post, ranked (MATRICES.md §2): at most one
 * primary action, the next most likely as secondary, everything else under
 * "More". Built on lib/social-hub/house.ts actionsFor, which says what each
 * type supports; this file says how it's offered for the post's state.
 */

export type PostPlan = Extract<ActionPlan, { kind: 'post' }>;
export type LinkPlan = Extract<ActionPlan, { kind: 'link' }>;

export type SlotChoice = { nyDate: string; dayLabel: string; slot: string; label: string; range: string; state: 'free' | 'taken' | 'current' };

export type OfferedAction = {
  key: string;
  label: string;
  plan: PostPlan;
  /** For place and reschedule: the next days' windows for the type, with what's taken. */
  slots?: SlotChoice[];
  /** Visible reason it can't run now (quota, nothing made yet, turned off). */
  disabled: string | null;
  danger: boolean;
  confirmTitle: string | null;
};

export type ActionMenu = {
  primary: OfferedAction | null;
  secondary: OfferedAction[];
  more: OfferedAction[];
  links: LinkPlan[];
  /** Shown when every action is turned off: one honest line, not a row of dead buttons. */
  offNote: string | null;
};

type Rank = 'primary' | 'secondary' | 'more' | 'hide';

const OFF = 'Turned off for now.';

/** Pipelines with their own review page outside the hub (carousels are reviewed only here). */
const OWN_PAGE: Partial<Record<HubPost['vertical'], string>> = { reels: '/reels', explainers: '/explainers/reels', stories: '/stories' };

function rankFor(state: PostState['id'], action: PostPlan['action']): Rank {
  const approve = action === 'approveCarousel' || action === 'approveTrialReel' || action === 'approveContent';
  switch (state) {
    case 'needs_you':
    case 'slot_booked':
      return approve ? 'primary' : action === 'reject' ? 'secondary' : 'more';
    case 'ready':
      return approve ? 'primary' : action === 'place' ? 'secondary' : 'more';
    case 'approved':
      return action === 'place' ? 'primary' : approve ? 'hide' : 'more';
    case 'scheduled':
      return approve ? 'hide' : action === 'reschedule' ? 'secondary' : 'more';
    case 'failed':
      return action === 'hardPublish' ? 'primary' : action === 'hardRegenerate' ? 'secondary' : 'more';
    case 'not_approved':
    case 'cancelled':
      return action === 'place' ? 'primary' : action === 'hardRegenerate' ? 'secondary' : action === 'reject' ? 'more' : 'hide';
    default:
      return 'hide';
  }
}

/** The flag that gates each action (both placement routes share `reschedule`, D50). */
export function flagOf(action: PostPlan['action']): ActionFlag {
  return action === 'place' ? 'reschedule' : action;
}

function labelFor(state: PostState['id'], plan: PostPlan, vertical: HubPost['vertical']): string {
  switch (plan.action) {
    case 'approveCarousel':
    case 'approveTrialReel':
    case 'approveContent':
      if (state === 'slot_booked') return 'Approve slot';
      return vertical === 'carousels' && state === 'ready' ? 'Approve and schedule' : 'Approve';
    case 'hardPublish':
      return state === 'failed' ? 'Try again' : 'Publish now';
    case 'hardRegenerate':
      return 'Regenerate';
    case 'reject':
      return 'Reject';
    case 'place':
      return 'Schedule…';
    case 'reschedule':
      return 'Move…';
  }
}

const TITLE: Partial<Record<PostPlan['action'], string>> = {
  hardPublish: 'Publish now?',
  hardRegenerate: 'Make a new version?',
  reject: 'Reject this post?',
  place: 'Schedule it',
  reschedule: 'Move it',
};

export function actionMenu(post: HubPost, state: PostState, plans: readonly ActionPlan[], enabled: Readonly<Record<ActionFlag, boolean>>, slots?: SlotChoice[]): ActionMenu {
  const menu: ActionMenu = { primary: null, secondary: [], more: [], links: [], offNote: null };
  let offered = 0;
  let off = 0;
  for (const plan of plans) {
    if (plan.kind === 'link') {
      // Only "review it where it lives" is offered as a link; reruns become real actions (A1), never a link dressed as one.
      if (plan.label === 'Review' && state.id === 'needs_you') menu.links.push({ ...plan, label: `Review in ${verticalInfo(post.vertical).label}` });
      continue;
    }
    const rank = rankFor(state.id, plan.action);
    if (rank === 'hide') continue;
    offered += 1;
    const isOff = !enabled[flagOf(plan.action)];
    if (isOff) off += 1;
    const action: OfferedAction = {
      key: plan.action,
      label: labelFor(state.id, plan, post.vertical),
      plan,
      disabled: isOff ? OFF : plan.disabled,
      danger: plan.action === 'reject',
      confirmTitle: TITLE[plan.action] ?? null,
      ...(plan.pick === 'slot' && slots ? { slots } : {}),
    };
    if (isOff) continue;
    if (rank === 'primary' && !menu.primary) menu.primary = action;
    else if (rank === 'primary' || rank === 'secondary') menu.secondary.push(action);
    else menu.more.push(action);
  }
  // A late post's only honest next step is to look where it's published from (critique 2026-10-08, P1-C).
  if (state.id === 'late' && !menu.links.length) {
    const own = OWN_PAGE[post.vertical] ?? post.pipelineHref;
    if (own) menu.links.push({ kind: 'link', label: `Check it in ${verticalInfo(post.vertical).label}`, href: own, note: '' });
  }
  if (offered > 0 && off === offered) {
    const own = OWN_PAGE[post.vertical];
    menu.offNote = own && state.id === 'needs_you'
      ? `Approving here is turned off for now. Review it in ${verticalInfo(post.vertical).label}.`
      : 'Actions here are turned off for now.';
    if (own && state.id === 'needs_you' && !menu.links.some((l) => l.href === own || l.label.startsWith('Review'))) {
      menu.links.unshift({ kind: 'link', label: `Review in ${verticalInfo(post.vertical).label}`, href: own, note: '' });
    }
  }
  return menu;
}

/** "Schedule here" on an open calendar slot: one preset placement (D50), no picker. */
export function placeHereMenu(refs: Record<string, string | undefined>, vertical: HubPost['vertical'], nyDate: string, slot: string, enabled: Readonly<Record<ActionFlag, boolean>>): ActionMenu {
  const off = !enabled.reschedule;
  const plan: PostPlan = {
    kind: 'post',
    action: 'place',
    label: 'Schedule here',
    endpoint: '/api/social-hub/actions/place',
    body: { vertical, refs, nyDate, slot },
    disabled: Object.values(refs).some((v) => !v) ? 'This content can’t be found any more.' : null,
  };
  const action: OfferedAction = { key: 'place', label: 'Schedule here', plan, disabled: off ? OFF : plan.disabled, danger: false, confirmTitle: null };
  return { primary: off ? null : action, secondary: [], more: [], links: [], offNote: off ? 'Scheduling from the hub is turned off for now.' : null };
}
