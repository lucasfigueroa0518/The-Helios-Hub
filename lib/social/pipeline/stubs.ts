/**
 * Canned stub stages for tests and the dry run. No network, no model.
 *
 * Costs are fake but in the right ballpark (spec §4.2b: ~$0.85/attempt),
 * so cost-cap behaviour is realistic.
 */
import type { PipelineStages } from './stages';
import type { Candidate, ReasonCode, StageName, StageResult } from './types';

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

export const STUB_CANDIDATES: Candidate[] = [
  { id: 'story-a', title: 'Lab ships new model', url: 'https://example.com/a' },
  { id: 'story-b', title: 'State signs AI law', url: 'https://example.com/b' },
  { id: 'story-c', title: 'Chipmaker posts record quarter', url: 'https://example.com/c' },
];

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
    async score(candidates) {
      opts.calls?.push({ stage: 'jev-scoring', storyId: '*' });
      // Earlier in the list = higher score, so rank order is predictable.
      const scored = candidates.map((c, i) => ({ ...c, score: candidates.length - i }));
      return { ok: true, value: scored, costUsd: cost('jev-scoring') };
    },
    async report(story) {
      return result('reporter', story.id, { storyId: story.id, news: `${story.title}.` });
    },
    async write(brief) {
      return result('writer', brief.storyId, {
        storyId: brief.storyId,
        slides: [
          { headline: brief.news, body: 'What happened, in one line.' },
          { headline: 'Why it matters', body: 'What it means for the reader.' },
        ],
        caption: `${brief.news} Source: example.com`,
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
