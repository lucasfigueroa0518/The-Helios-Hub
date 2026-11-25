/** Story mapping and the Jev state for the lab; question sets and scores come straight from R's modules. */
import { bigOutletsOf } from '@/lib/intake/outlets';
import { representativeOf } from '@/lib/intake/scorecards';
import type { ScoredStory } from '@/lib/intake/types';
import type { RankerStory } from '@/lib/news-ranker/types';

export { BUILDER, MAJOR_NEWS, NEWS_GATE, UNTRUSTED } from '@/lib/news-ranker/questions';
export { BUILDER_WEIGHTS, GATE_BAR, MAJOR_NEWS_WEIGHTS, builderScore, leadOf, majorNewsScore } from '@/lib/news-ranker/scores';

const BODY_CHARS = 9000;
const SUMMARY_CHARS = 400;

/** Intake story → RankerStory (R's `candidatesFor` does this in production). */
export function toRankerStory(s: ScoredStory): RankerStory {
  const rep = representativeOf(s, s.members);
  const longest = s.members.reduce((best, m) => (m.body.length > best.length ? m.body : best), '');
  const text = (rep.body || longest).slice(0, BODY_CHARS);
  return {
    storyId: s.id,
    key: s.representativeKey,
    memberKeys: s.members.map((m) => m.key),
    headline: s.headline || rep.headline,
    summary: text.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS),
    text,
    eventDate: s.eventDate,
    firstSeen: s.firstSeenAt,
    outlets: bigOutletsOf(s.members),
    stored: { major: s.scores['major-news'] ?? null, builder: s.scores['story-builder'] ?? null },
  };
}

/** The Jev state every lab set sees (same shape as intake's majorState). */
export function jevState(s: RankerStory) {
  return {
    headline: s.headline,
    outlets: s.outlets,
    published: s.eventDate ? s.eventDate.toISOString() : null,
    story: { untrusted_content: s.text },
  };
}
