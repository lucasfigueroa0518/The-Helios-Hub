import { carouselIdeas, carouselPosts } from '@/lib/social-hub/adapters/carousels';
import { explainerIdeas, explainerPosts } from '@/lib/social-hub/adapters/explainers';
import { reelIdeas, reelPosts } from '@/lib/social-hub/adapters/reels';
import { storyIdeas, storyPosts } from '@/lib/social-hub/adapters/stories';
import type { CarouselsRead } from '@/lib/social-hub/queries/carousels';
import type { ExplainersRead } from '@/lib/social-hub/queries/explainers';
import type { ReelsRead } from '@/lib/social-hub/queries/reels';
import type { StoriesRead } from '@/lib/social-hub/queries/stories';
import { allocate, withCosts, type CostLedger } from '@/lib/social-hub/cost';
import { agreement, buildLedger, type CostReads } from '@/lib/social-hub/queries/costs';
import { dedupeSources } from '@/lib/social-hub/sources';
import type { AccountRead } from '@/lib/social-hub/queries/account';
import type { HubIdea, HubPost, HubSource, Vertical } from '@/lib/social-hub/types';

export type VerticalReads = {
  reels: ReelsRead | Error;
  explainers: ExplainersRead | Error;
  carousels: CarouselsRead | Error;
  stories: StoriesRead | Error;
};

export type HubDataset = {
  posts: HubPost[];
  ideas: HubIdea[];
  sources: HubSource[];
  /** A vertical whose read failed shows an error note; the rest of the hub still works. */
  errors: Array<{ vertical: Vertical; message: string }>;
  /** The allocated ledger (§8a); null when the cost reads failed. */
  cost: CostLedger | null;
  /** Cost read failures and denormalized-total disagreements, shown as notes. */
  costNotes: string[];
  /** Newest quota message the publishers logged, if any (Content House header). */
  latestQuota: { text: string | null; at: string | null } | null;
  /** `social_hub` account tables: absent until applied (Phase 2), then filled by the collector. */
  account: AccountRead;
  loadedAt: string;
};

function adapt(reads: VerticalReads, vertical: Vertical): { posts: HubPost[]; ideas: HubIdea[] } | Error {
  switch (vertical) {
    case 'reels': {
      const r = reads.reels;
      return r instanceof Error ? r : { posts: reelPosts(r), ideas: reelIdeas(r.ideas) };
    }
    case 'explainers': {
      const r = reads.explainers;
      return r instanceof Error ? r : { posts: explainerPosts(r), ideas: explainerIdeas(r.topics) };
    }
    case 'carousels': {
      const r = reads.carousels;
      return r instanceof Error ? r : { posts: carouselPosts(r), ideas: carouselIdeas(r.ideas) };
    }
    case 'stories': {
      const r = reads.stories;
      return r instanceof Error ? r : { posts: storyPosts(r), ideas: storyIdeas(r.candidates) };
    }
  }
}

const ORDER: Vertical[] = ['reels', 'explainers', 'carousels', 'stories'];

export function buildDataset(
  reads: VerticalReads,
  costReads: CostReads | Error | null = null,
  now = new Date(),
  latestQuota: HubDataset['latestQuota'] = null,
  account: AccountRead = { present: false },
): HubDataset {
  const posts: HubPost[] = [];
  const ideas: HubIdea[] = [];
  const errors: HubDataset['errors'] = [];
  for (const vertical of ORDER) {
    try {
      const adapted = adapt(reads, vertical);
      if (adapted instanceof Error) {
        errors.push({ vertical, message: adapted.message });
        continue;
      }
      posts.push(...adapted.posts);
      ideas.push(...adapted.ideas);
    } catch (error) {
      errors.push({ vertical, message: error instanceof Error ? error.message : String(error) });
    }
  }
  let cost: CostLedger | null = null;
  const costNotes: string[] = [];
  if (costReads instanceof Error) costNotes.push(`Cost could not be read: ${costReads.message}`);
  else if (costReads) {
    const { rows, pools } = buildLedger(costReads);
    cost = allocate(rows, pools);
    costNotes.push(...agreement(costReads));
    const missing = (costReads as CostReads & { explainersMissing?: string }).explainersMissing;
    if (missing) costNotes.push(`Explainer costs not included: ${missing}`);
  }
  const costed = cost ? withCosts(posts, cost) : posts;
  costed.sort((a, b) => (b.postedAt ?? b.publishAt ?? '').localeCompare(a.postedAt ?? a.publishAt ?? '') || a.id.localeCompare(b.id));
  return { posts: costed, ideas, sources: dedupeSources(costed), errors, cost, costNotes, latestQuota, account, loadedAt: now.toISOString() };
}

export function findPost(dataset: HubDataset, id: string): HubPost | null {
  return dataset.posts.find((p) => p.id === id) ?? dataset.posts.find((p) => p.aliases?.includes(id)) ?? null;
}
