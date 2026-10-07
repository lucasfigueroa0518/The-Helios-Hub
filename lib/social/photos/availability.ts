/**
 * What photo a SUBJECTS entry can have (photo spec §2–§4): one definition
 * the Writer's flags and the finder share, so the Writer asks only for what
 * the finder can deliver.
 *
 *   person        headshot: the identity-verified entry's main photo (P18)
 *                 is usable (p18.ts)
 *   organization  logo: the verified entry's logo (P154) passes the
 *                 Commons licence check (logo.ts); photo: its main photo
 *                 (P18, often its headquarters) is usable, same rule as a
 *                 headshot (Tommy, 2026-10-07: buildings are welcome on
 *                 slides about the company). The finder also requires that
 *                 the face detector finds no face in it (Link 4).
 *   unclear       nothing (the identity check failed or couldn't tell)
 *
 * Code plus the existing identity check (Jev), cached per story. Whether a
 * photo is free in a given post (the 7-day rule) is the finder's question.
 */
import type { JevAsk } from '@/lib/social/jev/client';
import type { Brief } from '@/lib/social/reporter/brief';

import type { SubjectType } from './identity';
import { fetchLogo } from './logo';
import { identityOf, subjectP18, type IdentityCache } from './p18';

/** `photo`: an organization's main photo (P18). `headshot`: a person's. */
export type Availability = { kind: SubjectType | null; headshot: boolean; logo: boolean; photo: boolean };

export type SubjectAvailability = (subject: { name: string; role: string | null }, brief: Brief) => Promise<Availability>;

export const NOTHING: Availability = { kind: null, headshot: false, logo: false, photo: false };

export function createSubjectAvailability(deps: { jev: JevAsk; http?: typeof fetch }, cacheFor: (brief: Brief) => IdentityCache): SubjectAvailability {
  return async (subject, brief) => {
    const cache = cacheFor(brief);
    const id = await identityOf(subject.name, brief, deps, cache);
    if (!id.ok) return { kind: id.type, headshot: false, logo: false, photo: false };
    if (id.type === 'person') {
      const r = await subjectP18(subject.name, brief, deps, cache);
      return { kind: 'person', headshot: r.pick !== null, logo: false, photo: false };
    }
    const [logo, main] = await Promise.all([fetchLogo(id.qid, id.label, { http: deps.http }), subjectP18(subject.name, brief, deps, cache)]);
    return { kind: 'organization', headshot: false, logo: logo.photo !== null, photo: main.pick !== null };
  };
}
