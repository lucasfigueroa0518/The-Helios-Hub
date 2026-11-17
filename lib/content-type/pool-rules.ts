import { leadDaysFor } from '@/lib/social-hub/lead';
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
  return leadDaysFor(type, type === 'stories' ? storySeriesOf(series) : null) > 0 ? 'evergreen' : 'time_sensitive';
}
