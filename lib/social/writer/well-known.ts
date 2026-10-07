/**
 * "Widely known" for the cover rule (spec §4.1a): a subject counts as well
 * known when its SUBJECTS entry has a Wikidata match. Code, no AI: the
 * pulled resolver (exact label, or a clear match against the brief's text).
 */
import { resolveSubject } from '@/lib/social/editorial/v2/image-step/wikidata';
import type { Brief } from '@/lib/social/reporter/brief';

import { fetchEntityP18, fetchImageInfo, toCandidate } from '@/lib/social/editorial/v2/image-step/commons';
import { STOCK_MIN_SHORT_SIDE } from '@/lib/social/photos/find';

import type { HasPhoto, IsWellKnown } from './writer';

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

/**
 * photo_available (handoff, Tommy 2026-10-06): the subject has a Wikidata
 * match whose main image (P18) is usable. Code only, no AI; the design
 * stage still runs the full identity check before a photo is used.
 */
export const hasPhotoLive: HasPhoto = async (subject, brief: Brief) => {
  const res = await resolveSubject({
    subject: subject.name,
    briefTerms: [
      ...brief.subjects.map((s) => ({ name: s.name, description: s.role ?? '' })),
      ...brief.terms.map((t) => ({ name: t.name, description: t.definition })),
    ],
    briefStory: [brief.the_news.text, ...brief.facts.map((f) => f.text)].join(' '),
  });
  if (!res.ok) return false;
  const p18 = await fetchEntityP18(res.candidate.id);
  if (!p18) return false;
  const file = `File:${p18}`;
  const info = (await fetchImageInfo([file]))[file];
  return Boolean(info && toCandidate(file, info, 'P18', { minShortSide: STOCK_MIN_SHORT_SIDE }));
};
