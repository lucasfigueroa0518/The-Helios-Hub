import { formatUsd } from '@/lib/social-hub/cost';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { ACTION_FLAGS, actionEnabled, SOCIAL_HUB_FLAGS, type ActionFlag, type HubFlags } from '@/lib/social-hub/flags';
import { actionsFor, contentRefs, quotaFrom, typicalCost } from '@/lib/social-hub/house';
import { actionMenu, placeHereMenu, type ActionMenu, type SlotChoice } from '@/lib/social-hub/views/actions';
import { dayWord } from '@/lib/social-hub/views/format';
import { windowRange, windowsOn } from '@/lib/social-hub/views/plan';
import { addDays, nyDateOf, nyDayStart } from '@/lib/social-hub/time';
import { approvalOffState, postState, type PostState } from '@/lib/social-hub/views/state';
import { typicals, type Typicals } from '@/lib/social-hub/views/typical';
import type { HubPost } from '@/lib/social-hub/types';

/**
 * Everything a screen needs to show one post consistently: its state and
 * its ranked actions, computed once per request on the server.
 */
export type Offer = { state: PostState; menu: ActionMenu };

export type Offerer = { offer: (post: HubPost) => Offer; placeHere: (post: HubPost, nyDate: string, slot: string) => ActionMenu; typical: Typicals; now: Date };

const ACTIVE = new Set(['scheduled', 'publishing', 'published']);

/**
 * The next week of a type's posting windows (place and reschedule, D50): what's
 * free, what's taken, and where this post already sits. The server checks
 * again when the move is made (spacing, quota, a slot taken meanwhile).
 */
export function slotChoices(dataset: HubDataset, post: HubPost, now: Date, days = 7): SlotChoice[] {
  const today = nyDateOf(now)!;
  const placed = dataset.posts.filter((p) => p.vertical === post.vertical && ACTIVE.has(p.status) && p.nyDate);
  const out: SlotChoice[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const onDay = placed.filter((p) => p.nyDate === day);
    windowsOn(post.vertical, day).forEach((w, index) => {
      const closes = nyDayStart(day).getTime() + w.endMinute * 60_000;
      if (closes <= now.getTime()) return;
      const holder = post.vertical === 'stories' ? onDay[index] : onDay.find((p) => p.slot?.id === w.id);
      out.push({
        nyDate: day,
        dayLabel: dayWord(day, now),
        slot: w.id,
        label: w.label,
        range: windowRange(w),
        state: holder ? (holder.id === post.id ? 'current' : 'taken') : 'free',
      });
    });
  }
  return out;
}

export function offerer(dataset: HubDataset, now: Date, flags: HubFlags = SOCIAL_HUB_FLAGS): Offerer {
  const today = nyDateOf(now)!;
  const quota = quotaFrom(dataset.latestQuota, dataset.posts, now);
  const enabled = Object.fromEntries(ACTION_FLAGS.map((f) => [f, actionEnabled(f, flags)])) as Record<ActionFlag, boolean>;
  const costLabel = new Map<HubPost['vertical'], string>();
  const label = (v: HubPost['vertical']) => {
    if (!costLabel.has(v)) costLabel.set(v, formatUsd(typicalCost(dataset.posts, v, today)));
    return costLabel.get(v)!;
  };
  const offers = new Map<string, Offer>();
  return {
    now,
    typical: typicals(dataset.posts, now),
    placeHere: (post, nyDate, slot) => placeHereMenu(contentRefs(post), post.vertical, nyDate, slot, enabled),
    offer: (post) => {
      const hit = offers.get(post.id);
      if (hit) return hit;
      const made = build(post);
      offers.set(post.id, made);
      return made;
    },
  };

  function build(post: HubPost): Offer {
      const state = postState(post, now);
      const plans = actionsFor(post, { quota, typicalCostLabel: label(post.vertical) });
      const slots = plans.some((p) => p.kind === 'post' && p.pick === 'slot') ? slotChoices(dataset, post, now) : undefined;
      const menu = actionMenu(post, state, plans, enabled, slots);
      const reachable = Boolean(menu.primary || menu.secondary.length || menu.more.length || menu.links.length);
      // Orange only where a person can act: with every path off, the row goes quiet (critique P1-A).
      if (state.id === 'needs_you' && !reachable) return { state: approvalOffState(post, now), menu: { ...menu, offNote: null } };
      return { state, menu };
  }
}
