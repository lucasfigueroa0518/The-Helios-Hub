/**
 * The article photos and official images a post may use (photo spec §2,
 * §3), built by code from the pages the Reporter opened (the page reader's
 * exact record, never a retyped copy). The Writer sees this list as ARTICLE
 * PHOTOS and the finder uses the same one, so the Writer asks only for what
 * the finder can deliver.
 *
 *   Rule 1  only photos inside the article body as the page reader extracts
 *           them (<figure>). og:image counts only if it is the same photo
 *           as one in the body (Tommy, 2026-10-07); the page reader already
 *           folds that case into the body photo, so a separate og:image is
 *           never listed.
 *   Rule 2  no caption, no use (official images excepted).
 *   Rule 3  the caption must name a SUBJECTS entry; the entry carries the
 *           IDs it names, and a slide may show it only when tagged with one.
 *   Rule 4  official images: a figure on a SUBJECTS company's own page
 *           (official-domains.ts). The page counts as the caption; it goes
 *           on the cover or a slide tagged with that company only.
 *   Credit  the existing credit check (credit.ts): agencies and the outlet's
 *           own staff are rejected everywhere; an article photo also needs
 *           an allowed credit. An official image is credited by code.
 */
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';

import { classifyCredit } from './credit';
import type { SubjectType } from './identity';
import { namedSubjects, subjectIdsNamedIn } from './named';
import { officialSubjectOf, type OfficialDomains, OFFICIAL_DOMAINS } from './official-domains';

export type ListedPhoto = {
  url: string;
  caption: string | null;
  credit: string | null;
  page: string;
  /** SUBJECTS IDs the caption names. */
  subject_ids: string[];
  /** Official images: the SUBJECTS ID of the company whose own page it is. */
  official_of: string | null;
  /** Pixel width when the page states one (srcset or width attribute). */
  width?: number | null;
};

export const photoUrlKey = (u: string) => u.replace(/^https?:\/\//, '').replace(/[?#].*$/, '');

/** `kinds`: each subject's type from the identity check (the naming rule depends on it); unknown when absent. */
export function articlePhotosFor(brief: Brief, pages: PageReadOk[], kinds: Map<string, SubjectType | null> | null = null, list: OfficialDomains[] = OFFICIAL_DOMAINS): ListedPhoto[] {
  const subjects = brief.subjects.filter((s) => s.id);
  const named = namedSubjects(subjects, kinds);
  const organizations = brief.subjects.map((s) => s.name);
  const out: ListedPhoto[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const pageUrl = page.resolvedUrl || page.url;
    const official = officialSubjectOf(pageUrl, subjects, list);
    for (const p of page.photos) {
      if (p.from !== 'figure') continue;
      const key = photoUrlKey(p.src);
      if (seen.has(key)) continue;
      const caption = p.caption?.trim() || null;
      const names = caption ? subjectIdsNamedIn(caption, named) : [];
      if (official) {
        // Agencies are rejected even on a company's own page; the outlet rule doesn't apply there.
        if (classifyCredit({ caption: p.caption, credit: p.credit, page: null, organizations: [] }).verdict === 'rejected') continue;
        seen.add(key);
        out.push({ url: p.src, caption, credit: p.credit, page: pageUrl, subject_ids: names, official_of: official.subject.id, width: p.width ?? null });
        continue;
      }
      if (!caption || names.length === 0) continue;
      if (classifyCredit({ caption: p.caption, credit: p.credit, page: pageUrl, organizations }).verdict !== 'allowed') continue;
      seen.add(key);
      out.push({ url: p.src, caption, credit: p.credit, page: pageUrl, subject_ids: names, official_of: null, width: p.width ?? null });
    }
  }
  return out;
}
