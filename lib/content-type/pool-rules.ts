import { leadDaysFor } from '@/lib/social-hub/lead';
import { POOL_CAP } from '@/lib/social-hub/queue';
import { isStoryVertical } from '@/lib/social-hub/story-types';
import { SERIES_NAME } from '@/lib/social-hub/slots/times';
import type { StorySeries } from '@/lib/social-hub/slots/types';
import type { HubIdea, HubPost, Vertical } from '@/lib/social-hub/types';
import { needsPerson } from '@/lib/social-hub/views/state';

/**
 * The pool screen's row rules (pool UI contract 2026-11-15 §2–3): what state a row is in, the one word each state
 * shows, and whether a pool's unmade ideas are evergreen. Pure, no server imports, so the screen, the page and the
 * tests read the same rules.
 */

export type PoolRowState = 'idea' | 'making' | 'failed' | 'ready' | 'scheduled' | 'needs_you' | 'posted';

/** The words a row shows for its state. The only place these are written. */
export const POOL_STATE_WORDS: Readonly<Record<PoolRowState, string>> = Object.freeze({
  idea: 'Idea',
  making: 'Making',
  failed: 'Failed, try again',
  ready: 'Ready',
  scheduled: 'Scheduled',
  needs_you: 'Needs you',
  posted: 'Published',
});

/**
 * An Ideas-tab row's state. A render that is queued or running is Making; one whose latest try failed is Failed.
 * Otherwise the idea's own state: an unmade idea is an Idea. (Made, booked and posted ideas belong to the Made tab;
 * their states are given here so nothing reads as an Idea by accident.)
 * The run's error never becomes row text: it shows only in the panel, under "The last try stopped."
 */
export function poolRowState(idea: HubIdea): PoolRowState {
  const run = idea.run?.state;
  if (run === 'queued' || run === 'running') return 'making';
  if (run === 'failed') return 'failed';
  switch (idea.state) {
    case 'content_ready':
      return 'ready';
    case 'on_deck':
      return 'scheduled';
    case 'published':
      return 'posted';
    default:
      return 'idea';
  }
}

/**
 * A made post's state (Made tab and board). Still being made → Making; posted → Published; publish failed →
 * Failed; waiting on a person's approval → Needs you; booked or posting → Scheduled; anything else made → Ready.
 * With `now`, approval follows the hub's own rule (views/state.ts needsPerson, so counts agree with the Content
 * House); without it, a booked or made post with a required approval not yet given reads as Needs you.
 */
export function madeRowState(post: HubPost, now?: Date): PoolRowState {
  switch (post.status) {
    case 'generating':
      return 'making';
    case 'published':
      return 'posted';
    case 'failed':
      return 'failed';
  }
  const waiting = now
    ? needsPerson(post, now)
    : (post.status === 'scheduled' || post.status === 'ready') && post.approval.required && !post.approval.approvedAt;
  if (waiting) return 'needs_you';
  if (post.status === 'scheduled' || post.status === 'publishing') return 'scheduled';
  return 'ready';
}

/** A Stories series id from its id or its name ("Guess the Number" → guess_the_number); null for anything else. */
export function storySeriesOf(group: string | null | undefined): StorySeries | null {
  if (!group) return null;
  for (const id of Object.keys(SERIES_NAME) as StorySeries[]) {
    if (group === id || group === SERIES_NAME[id].one) return id;
  }
  return null;
}

export type PoolFreshness = 'evergreen' | 'time_sensitive';

/**
 * Whether a pool's unmade ideas keep (evergreen) or are archived 30 days after they entered (time_sensitive). Not a
 * setting: it is the lead-time split (lib/social-hub/lead.ts, Bald-Eagle D4). A type made ahead is evergreen; a
 * type made the day it posts is time-sensitive. Stories go by series (id or name). Field Notes is evergreen but
 * keeps its own tip expiry (expireOldTips).
 */
export function poolFreshness(type: Vertical, series?: StorySeries | string | null): PoolFreshness {
  return leadDaysFor(type, isStoryVertical(type) ? storySeriesOf(series) : null) > 0 ? 'evergreen' : 'time_sensitive';
}

/**
 * The types whose Seed switches off at the pool cap: their worker trims the pool to POOL_CAP open ideas and a seed would
 * be cut (Explainers: lib/explainers/ideas/evaluate.ts; Morning Download: lib/stories/pool.ts). Every other type's list
 * is a view capped at 30 over a longer pool. Trivia and Real or AI? are trimmed too, but to their own aims (50 and 40
 * unused) and seeded rows are exempt from those caps, so their Seed is never off.
 */
export const SEED_CAPPED: ReadonlySet<Vertical> = new Set<Vertical>(['explainers', 'stories']);

/**
 * True when the pool screen's Seed is off because the pool is full. Explainers: the whole pool (`poolOpen`, uncapped),
 * less what was just archived on screen (`hidden`). Morning Download: per series (`openIn`); with no series picked it is
 * off only when every series is full.
 */
export function seedPoolFull(i: {
  vertical: Vertical;
  poolOpen: number;
  hidden: number;
  group: string | null;
  groups: readonly string[];
  openIn: (group: string) => number;
  cap?: number;
}): boolean {
  const cap = i.cap ?? POOL_CAP;
  if (!SEED_CAPPED.has(i.vertical)) return false;
  if (isStoryVertical(i.vertical)) {
    const full = (name: string) => i.openIn(name) >= cap;
    return i.group ? full(i.group) : i.groups.length > 0 && i.groups.every(full);
  }
  return i.poolOpen - i.hidden >= cap;
}
