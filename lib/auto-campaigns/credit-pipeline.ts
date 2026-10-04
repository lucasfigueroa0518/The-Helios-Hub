/**
 * Apollo credit rule:
 * - people search is free and may repeat
 * - enrich is paid
 * - our code, not Claude, chooses who to enrich
 * - drop known apollo_person_ids (and known LinkedIn URLs) BEFORE any enrich
 * - keep enriching never-seen IDs until `emails_per_day` verified emails attach
 * - never enrich someone already stored
 * - a stored lead from another campaign can fill today's quota without a new enrich
 * - a lead already on this campaign stays skipped
 * - organization search is opt-in paid (1 credit/page) and off by default
 * - stopping at N enrich attempts when fewer than N verified emails attached is a defect
 */
import type { PeopleSearchHit } from '@/lib/auto-campaigns/types';

export const APOLLO_SEARCH_PER_PAGE = 100;
export const APOLLO_ENRICH_BATCH = 10;
export const APOLLO_MAX_SEARCH_PAGES_PER_CYCLE = 40;

export function normalizeLinkedinUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim().toLowerCase().replace(/\/+$/, '');
  const match = trimmed.match(/linkedin\.com\/in\/([^/?#]+)/);
  if (!match) return null;
  return `linkedin.com/in/${match[1]}`;
}

export function organizationSearchAllowed(): boolean {
  return process.env.AUTO_APOLLO_ORG_SEARCH?.trim() === '1';
}

export function assertPeopleSearchTool(toolName: string): void {
  const name = toolName.trim().toLowerCase();
  if (name === 'search_organizations' || name === 'search_organization') {
    if (!organizationSearchAllowed()) {
      throw new Error(
        'Organization search spends 1 Apollo credit per page and is disabled. Set AUTO_APOLLO_ORG_SEARCH=1 only if you intend to spend that credit.',
      );
    }
    return;
  }
  if (name === 'enrich_people' || name === 'enrich_person' || name === 'bulk_enrich_people') {
    throw new Error('Claude must not call Apollo enrich. Our code enriches after dropping stored IDs.');
  }
  if (name !== 'search_people' && name !== 'search_person') {
    throw new Error(`Unsupported Apollo tool "${toolName}". Auto prospecting may people-search only.`);
  }
}

export type ReusePick = {
  /** Lead row to attach. May differ from the search hit when LinkedIn is the match. */
  apolloPersonId: string;
  hitApolloPersonId: string;
};

export function selectIdsToEnrich(input: {
  hits: PeopleSearchHit[];
  knownApolloIds: Set<string>;
  knownLinkedinUrls: Set<string>;
  quota: number;
  /** Stored on another campaign, with an email. Never enriched. */
  reusableApolloIds?: Set<string>;
  /** Normalized LinkedIn URL → stored Apollo id. */
  reusableLinkedinToApolloId?: Map<string, string>;
}): {
  toEnrich: string[];
  reuse: ReusePick[];
  skippedKnown: number;
  leftoverNew: number;
  pageExhausted: boolean;
} {
  const quota = Math.max(0, Math.floor(input.quota));
  const toEnrich: string[] = [];
  const reuse: ReusePick[] = [];
  const reuseIds = new Set<string>();
  let skippedKnown = 0;
  let leftoverNew = 0;
  let leftoverReuse = 0;

  const taken = () => toEnrich.length + reuse.length;

  for (const hit of input.hits) {
    const id = hit.apolloPersonId?.trim();
    if (!id) {
      skippedKnown += 1;
      continue;
    }
    const linkedin = normalizeLinkedinUrl(hit.linkedinUrl);
    const known = input.knownApolloIds.has(id)
      || (linkedin != null && input.knownLinkedinUrls.has(linkedin));
    if (known) {
      skippedKnown += 1;
      continue;
    }
    const reuseId = input.reusableApolloIds?.has(id)
      ? id
      : linkedin
        ? input.reusableLinkedinToApolloId?.get(linkedin) ?? null
        : null;
    if (reuseId) {
      if (reuseIds.has(reuseId)) continue;
      if (taken() >= quota) {
        leftoverReuse += 1;
        continue;
      }
      reuseIds.add(reuseId);
      reuse.push({ apolloPersonId: reuseId, hitApolloPersonId: id });
      continue;
    }
    if (taken() >= quota) {
      leftoverNew += 1;
      continue;
    }
    toEnrich.push(id);
  }

  return {
    toEnrich,
    reuse,
    skippedKnown,
    leftoverNew,
    pageExhausted: leftoverNew === 0 && leftoverReuse === 0,
  };
}

/** Advance the persisted people-search page only after this page has no unused new IDs. */
export function nextSearchPage(currentPage: number, pageExhausted: boolean): number {
  const page = Math.max(1, Math.floor(currentPage) || 1);
  if (!pageExhausted) return page;
  return page + 1;
}

export function chunkIds(ids: string[], size = APOLLO_ENRICH_BATCH): string[][] {
  const out: string[][] = [];
  const n = Math.max(1, size);
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
}
