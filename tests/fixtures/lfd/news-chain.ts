/**
 * An offline stand-in for Last Few Days' news chain (`deps.news`): the shortlist keeps the candidates' input order,
 * the rerank keeps the shortlist's order (with an angle per story), the writer echoes each headline with valid copy,
 * and the photo finder gives every story a good photo unless `noPhoto` matches its headline. No model, Jev, Serper
 * or web call is made. `seen` records what each step was handed.
 */
import type { LfdNewsChain } from '@/lib/lfd/run';

export function stubNewsChain(o: { noPhoto?: RegExp } = {}) {
  const seen = { shortlisted: [] as string[], written: [] as string[][], photos: [] as string[] };
  const news: LfdNewsChain = {
    shortlist: async (stories) => {
      const ranked = stories.map((s, i) => ({ ...s, cool: 0, value: 0, final: 1000 - i }));
      seen.shortlisted = ranked.map((s) => s.id);
      return { ranked, costUsd: 0 };
    },
    rerank: async (items) => ({
      graded: items.map((s) => ({ ...s, grade: { cool: 5, value: 5, duplicate_of: null, top_tier: false, crowds: [], angle: `angle ${s.headline}` } })),
      costUsd: 0,
    }),
    write: async (_format, stories, angles) => {
      seen.written.push(stories.map((s) => s.headline));
      return {
        written: stories.map((s) => ({ key: s.key, chosen: 'editor' as const, angle: angles[s.key] ?? '', headline: s.headline, body: 'It happened this week. The company says more is coming.', highlight: '', names: [] })),
        dropped: [], over: [], costUsd: 0, log: [],
      };
    },
    findPhoto: async (s) => {
      seen.photos.push(s.id);
      return o.noPhoto?.test(s.headline)
        ? { id: s.id, tier: 'none', pick: null, brief: null, costUsd: 0, log: ['no candidate cleared'] }
        : { id: s.id, tier: 'good', pick: { src: `https://p/${encodeURIComponent(s.url)}.jpg`, source: 'search', credit: 'C', tier: 'good', clarity: 8, jpeg: Buffer.alloc(0), width: 1200, height: 800 }, brief: null, costUsd: 0, log: [] };
    },
  };
  return { news, seen };
}
