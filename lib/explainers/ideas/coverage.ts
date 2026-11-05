import type { TopicRow } from '@/lib/explainers/types';

/**
 * The coverage map (planning/Explainer Reels/ideas-coverage/PLAN.md, approved 2026-11-03). Thirteen buckets of
 * idea categories, seven AI and six computer-science, each with the concepts it still has to teach. Code picks
 * tonight's buckets (least covered first, 2 AI : 1 CS) and the generator proposes inside them; dedupe looks at a
 * candidate's own bucket. Concept lists are guidance: an idea may fit a bucket without being on its list.
 */

export type Bucket = { id: string; name: string; kind: 'ai' | 'cs'; concepts: readonly string[] };

export const BUCKETS: readonly Bucket[] = [
  // ── AI ──
  { id: 'how-llms-work', name: 'How LLMs work', kind: 'ai', concepts: ['next-token prediction', 'parameters/weights', 'transformer', 'inference', 'logits/probabilities', 'multimodal models'] },
  { id: 'prompts-and-context', name: 'Prompts & context', kind: 'ai', concepts: ['prompt', 'few-shot examples', 'chain of thought', 'structured output', 'prompt caching', 'context engineering'] },
  { id: 'agents-and-tools', name: 'Agents & tools', kind: 'ai', concepts: ['tool calling', 'function schema', 'multi-agent systems', 'human-in-the-loop', 'guardrails', 'computer use'] },
  { id: 'retrieval-and-memory', name: 'Retrieval & memory', kind: 'ai', concepts: ['semantic search', 'reranking', 'knowledge base', 'long-term memory', 'hybrid search'] },
  { id: 'training-and-tuning', name: 'Training & tuning', kind: 'ai', concepts: ['pre-training', 'training data', 'overfitting', 'distillation', 'RLHF', 'synthetic data'] },
  { id: 'reliability-and-safety', name: 'Reliability & safety', kind: 'ai', concepts: ['grounding', 'benchmarks', 'bias', 'jailbreak', 'red-teaming', 'alignment'] },
  { id: 'running-models', name: 'Running models', kind: 'ai', concepts: ['reasoning models', 'latency', 'open vs closed weights', 'running locally', 'API pricing per token', 'batch processing'] },
  // ── Computer science ──
  { id: 'web-and-apis', name: 'Web & APIs', kind: 'cs', concepts: ['HTTP request', 'JSON', 'REST', 'status codes', 'browser', 'CDN', 'websockets'] },
  { id: 'data-and-databases', name: 'Data & databases', kind: 'cs', concepts: ['primary key', 'SQL query', 'schema', 'index', 'NoSQL', 'backups', 'data pipeline'] },
  { id: 'security-and-access', name: 'Security & access', kind: 'cs', concepts: ['encryption', 'password hashing', 'OAuth', '2FA', 'secrets', 'permissions'] },
  { id: 'code-and-teams', name: 'Code & teams', kind: 'cs', concepts: ['repository', 'commit', 'pull request', 'open source', 'code review', 'debugging', 'tests'] },
  { id: 'cloud-and-shipping', name: 'Cloud & shipping', kind: 'cs', concepts: ['cloud', 'deployment', 'local vs production', 'containers', 'cron jobs', 'serverless', 'logs'] },
  { id: 'how-software-is-built', name: 'How software is built', kind: 'cs', concepts: ['frontend framework', 'programming language', 'compiler vs interpreter', 'package manager', 'state', 'software architecture', 'algorithm'] },
];

export const BUCKET_IDS: readonly string[] = BUCKETS.map((b) => b.id);

export function bucketById(id: string | null | undefined): Bucket | null {
  return BUCKETS.find((b) => b.id === id) ?? null;
}

/**
 * The one-time map of rendered topics to buckets (2026-11-03), keyed by the lowercased term, or the lowercased title
 * for the renders that have no term. Topics written from here on carry their own `bucket`.
 */
export const RENDERED_BUCKETS: Readonly<Record<string, string>> = {
  'large language model': 'how-llms-work',
  token: 'how-llms-work',
  'neural network': 'how-llms-work',
  attention: 'how-llms-work',
  temperature: 'how-llms-work',
  'system prompt': 'prompts-and-context',
  'context window': 'prompts-and-context',
  'what is a context window?': 'prompts-and-context',
  'agent loop': 'agents-and-tools',
  'what is the loop that makes an ai agent work?': 'agents-and-tools',
  'why do ai agents need tools?': 'agents-and-tools',
  mcp: 'agents-and-tools',
  rag: 'retrieval-and-memory',
  embeddings: 'retrieval-and-memory',
  vector: 'retrieval-and-memory',
  'vector database': 'retrieval-and-memory',
  chunking: 'retrieval-and-memory',
  'model training': 'training-and-tuning',
  'fine-tuning': 'training-and-tuning',
  'reinforcement learning': 'training-and-tuning',
  hallucinations: 'reliability-and-safety',
  'why do ai models make things up with confidence?': 'reliability-and-safety',
  'ai evaluation': 'reliability-and-safety',
  'prompt injection': 'reliability-and-safety',
  gpu: 'running-models',
  'model routing': 'running-models',
  'system 1 model': 'running-models',
  quantization: 'running-models',
  api: 'web-and-apis',
  webhook: 'web-and-apis',
  'what is a server?': 'web-and-apis',
  dns: 'web-and-apis',
  'rate limits': 'web-and-apis',
  'frontend vs backend': 'web-and-apis',
  'what is a relational database?': 'data-and-databases',
  'what is the difference between authentication and authorization?': 'security-and-access',
  'api key': 'security-and-access',
  'git branch': 'code-and-teams',
  'environment variable': 'cloud-and-shipping',
  cache: 'cloud-and-shipping',
};

/**
 * A term for comparison: lowercase, trimmed, punctuation gone, each word's simple plural dropped. Free and
 * deliberately plain: it catches the same word written twice, not two words for one concept (that is Jev's job).
 */
export function normalizeTerm(term: string | null | undefined): string {
  return (term ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

/** A topic's bucket: its own column, else the one-time map by term, then by title. Null when neither knows it. */
export function topicBucket(topic: Pick<TopicRow, 'bucket' | 'term' | 'title'>): string | null {
  if (topic.bucket && bucketById(topic.bucket)) return topic.bucket;
  const byTerm = topic.term ? RENDERED_BUCKETS[topic.term.trim().toLowerCase()] : undefined;
  return byTerm ?? RENDERED_BUCKETS[topic.title.trim().toLowerCase()] ?? null;
}

/** How covered each bucket is: renders inside the coverage window, and the last render ever (ISO, null if none). */
export type BucketCoverage = Record<string, { renders: number; lastRenderedAt: string | null }>;

/** Coverage from rendered topics (any age): `windowDays` counts renders, the newest render breaks ties. */
export function bucketCoverage(
  rendered: readonly Pick<TopicRow, 'bucket' | 'term' | 'title' | 'rendered_at'>[],
  now: Date = new Date(),
  windowDays = 120,
): BucketCoverage {
  const coverage: BucketCoverage = Object.fromEntries(BUCKET_IDS.map((id) => [id, { renders: 0, lastRenderedAt: null }]));
  const since = now.getTime() - windowDays * 86_400_000;
  for (const topic of rendered) {
    const id = topicBucket(topic);
    if (!id || !topic.rendered_at) continue;
    const at = new Date(topic.rendered_at);
    const entry = coverage[id];
    if (at.getTime() >= since) entry.renders += 1;
    if (!entry.lastRenderedAt || at.getTime() > new Date(entry.lastRenderedAt).getTime()) entry.lastRenderedAt = at.toISOString();
  }
  return coverage;
}

/**
 * Tonight's buckets: least renders in the window first, then the oldest last render (never rendered first), then
 * the map's order; `ai` AI buckets then `cs` CS ones.
 */
export function pickBuckets(coverage: BucketCoverage, counts: { ai: number; cs: number } = { ai: 2, cs: 1 }): Bucket[] {
  const of = (id: string) => coverage[id] ?? { renders: 0, lastRenderedAt: null };
  const last = (id: string) => {
    const at = of(id).lastRenderedAt;
    return at ? new Date(at).getTime() : -Infinity;
  };
  const ranked = BUCKETS.map((b, i) => ({ b, i })).sort(
    (x, y) => of(x.b.id).renders - of(y.b.id).renders || last(x.b.id) - last(y.b.id) || x.i - y.i,
  );
  return [
    ...ranked.filter((r) => r.b.kind === 'ai').slice(0, counts.ai),
    ...ranked.filter((r) => r.b.kind === 'cs').slice(0, counts.cs),
  ].map((r) => r.b);
}

/** A bucket's concepts no rendered topic has taught yet (compared as normalized terms). */
export function conceptsToTeach(bucket: Bucket, rendered: readonly Pick<TopicRow, 'term' | 'title'>[]): string[] {
  const taught = new Set(rendered.flatMap((t) => [normalizeTerm(t.term), normalizeTerm(t.title)]));
  return bucket.concepts.filter((c) => !taught.has(normalizeTerm(c)));
}
