/**
 * Canned stub stages for tests and the dry run. No network, no model.
 *
 * Costs are fake but in the right ballpark (spec §4.2b: ~$0.85/attempt),
 * so cost-cap behaviour is realistic.
 */
import type { IngestArticle } from '@/lib/social/ingest/select/types';
import type { Brief as ParsedBrief } from '@/lib/social/reporter/brief';

import type { PipelineStages } from './stages';
import type { ReasonCode, ScoredCandidate, StageName, StageResult } from './types';

export const STUB_COST_USD: Record<StageName, number> = {
  'jev-scoring': 0.002,
  reporter: 0.35,
  writer: 0.25,
  editor: 0.12,
  'fact-checker': 0.003,
  design: 0.05,
  mechanical: 0,
};

export type StubFailure = {
  stage: Exclude<StageName, 'jev-scoring'>;
  reasonCode: ReasonCode;
  /** Only fail for this story; every story when omitted. */
  storyId?: string;
};

export type StubOptions = {
  failures?: StubFailure[];
  /** Override per-stage cost (e.g. to trip the cap quickly). */
  costUsd?: Partial<Record<StageName, number>>;
  /** Record every stage call, in order, for assertions. */
  calls?: Array<{ stage: StageName; storyId: string }>;
};

const stubArticle = (slug: string, headline: string): IngestArticle => ({
  feedSlug: 'stub-feed',
  feedKind: 'native',
  source: 'Example News',
  sourceUrl: `https://example.com/${slug}`,
  headline,
  byline: null,
  body: `${headline}.`,
  publishedAt: new Date('2026-10-04T12:00:00Z'),
});

export const STUB_ARTICLES: IngestArticle[] = [
  stubArticle('story-a', 'Lab ships new model'),
  stubArticle('story-b', 'State signs AI law'),
  stubArticle('story-c', 'Chipmaker posts record quarter'),
];

/** Stub selection: one candidate per article, in input order; id = last URL segment. */
export function stubCandidates(articles: IngestArticle[]): ScoredCandidate[] {
  return articles.map((a, i) => ({
    id: a.sourceUrl.split('/').pop()!,
    title: a.headline,
    url: a.sourceUrl,
    members: [{ url: a.sourceUrl, outlet: a.source, title: a.headline, publishedAt: a.publishedAt, feedSlug: a.feedSlug }],
    outlets: [a.source],
    outletCount: 1,
    publishedAt: a.publishedAt,
    body: a.body,
    score: articles.length - i,
  }));
}

/** Minimal parsed brief for stub runs. */
export function stubBrief(news: string): ParsedBrief {
  return {
    singleStory: true,
    news: { text: `${news}.`, ids: ['F1'] },
    whyItMatters: [],
    facts: [{ id: 'F1', text: `${news}.`, sources: ['Example News'], claimBy: null }],
    background: [],
    quotes: [],
    numbers: [],
    terms: [],
    subjects: [],
    events: [],
    articlePhotos: [],
    notAnswered: [],
    sources: [{ outlet: 'Example News', date: null, url: null }],
    fetchFailures: [],
    notes: {},
  };
}

export function createStubStages(opts: StubOptions = {}): PipelineStages {
  const cost = (stage: StageName) => opts.costUsd?.[stage] ?? STUB_COST_USD[stage];

  function result<T>(stage: Exclude<StageName, 'jev-scoring'>, storyId: string, value: T): StageResult<T> {
    opts.calls?.push({ stage, storyId });
    const fail = opts.failures?.find((f) => f.stage === stage && (!f.storyId || f.storyId === storyId));
    if (fail) {
      return { ok: false, reasonCode: fail.reasonCode, detail: `stub failure at ${stage}`, costUsd: cost(stage) };
    }
    return { ok: true, value, costUsd: cost(stage) };
  }

  return {
    async score(articles) {
      opts.calls?.push({ stage: 'jev-scoring', storyId: '*' });
      return { ok: true, value: stubCandidates(articles), costUsd: cost('jev-scoring') };
    },
    async report(story) {
      return result('reporter', story.id, { storyId: story.id, parsed: stubBrief(story.title), raw: '', pages: [] });
    },
    async write(brief) {
      return result('writer', brief.storyId, {
        storyId: brief.storyId,
        slides: [
          { headline: brief.parsed.news.text, body: 'What happened, in one line.' },
          { headline: 'Why it matters', body: 'What it means for the reader.' },
        ],
        caption: `${brief.parsed.news.text} Source: example.com`,
      });
    },
    async edit(draft) {
      return result('editor', draft.storyId, draft);
    },
    async factCheck(draft) {
      return result('fact-checker', draft.storyId, draft);
    },
    async design(draft, story) {
      return result('design', draft.storyId, {
        storyId: draft.storyId,
        title: story.title,
        slides: draft.slides.map((s) => ({ ...s, image: null })),
        caption: draft.caption,
        stages: [],
        costUsd: 0,
      });
    },
    async mechanical(post) {
      return result('mechanical', post.storyId, post);
    },
  };
}
