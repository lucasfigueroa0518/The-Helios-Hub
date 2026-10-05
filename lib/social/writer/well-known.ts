/**
 * "Widely known" for the cover rule (spec §4.1a): a subject counts as well
 * known when its SUBJECTS entry has a Wikidata match. Code, no AI: the
 * pulled resolver (exact label, or a clear match against the brief's text).
 */
import { resolveSubject } from '@/lib/social/editorial/v2/image-step/wikidata';
import type { Brief } from '@/lib/social/reporter/brief';

import type { IsWellKnown } from './writer';

export const isWellKnownLive: IsWellKnown = async (subject, brief: Brief) => {
  const res = await resolveSubject({
    subject: subject.name,
    briefTerms: [
      ...brief.subjects.map((s) => ({ name: s.name, description: s.role ?? '' })),
      ...brief.terms.map((t) => ({ name: t.name, description: t.definition })),
    ],
    briefStory: [brief.the_news.text, ...brief.facts.map((f) => f.text)].join(' '),
  });
  return res.ok;
};
