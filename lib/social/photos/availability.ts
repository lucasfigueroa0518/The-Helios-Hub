/**
 * What photo a SUBJECTS entry can have (photo spec §2–§4): one definition
 * the Writer's flags and the finder share, so the Writer asks only for what
 * the finder can deliver.
 *
 *   person        headshot: the identity-verified entry's main photo (P18)
 *                 is usable (p18.ts)
 *   organization  logo: the verified entry's logo (P154) passes the
 *                 Commons licence check (logo.ts). A company's main photo
 *                 (P18) is never used (Tommy, 2026-10-07: logos only).
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

/** `headshot`: a person's main photo (P18). `logo`: an organization's logo (P154). */
export type Availability = { kind: SubjectType | null; headshot: boolean; logo: boolean };

export type SubjectAvailability = (subject: { name: string; role: string | null }, brief: Brief) => Promise<Availability>;

export const NOTHING: Availability = { kind: null, headshot: false, logo: false };

export function createSubjectAvailability(deps: { jev: JevAsk; http?: typeof fetch }, cacheFor: (brief: Brief) => IdentityCache): SubjectAvailability {
  return async (subject, brief) => {
    const cache = cacheFor(brief);
    const id = await identityOf(subject.name, brief, deps, cache);
    if (!id.ok) return { kind: id.type, headshot: false, logo: false };
    if (id.type === 'person') {
      const r = await subjectP18(subject.name, brief, deps, cache);
      return { kind: 'person', headshot: r.pick !== null, logo: false };
    }
    const logo = await fetchLogo(id.qid, id.label, { http: deps.http });
    return { kind: 'organization', headshot: false, logo: logo.photo !== null };
  };
}
