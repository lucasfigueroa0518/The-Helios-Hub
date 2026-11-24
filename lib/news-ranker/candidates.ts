/**
 * News Ranker step 1 (CONTRACT.md): the central intake's stories in a format's
 * window, as RankerStory. Pure read over lib/intake/read.ts listStories. The
 * legacy reels/carousel lane mirroring in lib/intake/pool-lfd.ts stays until
 * the lab picks the scoring; this reader sits beside it.
 */
import { bigOutletsOf } from '@/lib/intake/outlets';
import { listStories } from '@/lib/intake/read';
import type { IntakeQuery, ScoredStory } from '@/lib/intake/types';

import type { NewsFormat, RankerStory } from './types';

export type CandidateWindow = { since: Date; until?: Date; limit?: number };

/** Body text budget for scoring (~1,500 words, as MD and LFD use). */
export const TEXT_CHARS = 9000;
const SUMMARY_CHARS = 600;

/** One intake story as the ranker sees it. */
export function toRankerStory(s: ScoredStory): RankerStory {
  const members = [...s.members].sort((a, b) => (a.role === 'primary' ? -1 : 0) - (b.role === 'primary' ? -1 : 0) || b.body.length - a.body.length);
  const text = (members.find((m) => m.body.trim())?.body ?? '').trim();
  return {
    storyId: s.id,
    key: s.representativeKey,
    memberKeys: s.members.map((m) => m.key),
    headline: s.headline,
    summary: text.slice(0, SUMMARY_CHARS),
    text: text.slice(0, TEXT_CHARS),
    eventDate: s.eventDate,
    firstSeen: s.firstSeenAt,
    outlets: bigOutletsOf(s.members),
    stored: { major: s.scores['major-news'] ?? null, builder: s.scores['story-builder'] ?? null },
  };
}

/** Intake stories active in the window (the format picks the window; `format` is kept for per-format filters). */
export async function candidatesFor(q: IntakeQuery, format: NewsFormat, window: CandidateWindow, now: Date): Promise<RankerStory[]> {
  void format;
  const until = window.until && window.until < now ? window.until : undefined;
  const stories = await listStories(q, { since: window.since, until, limit: window.limit });
  return stories.map(toRankerStory);
}
