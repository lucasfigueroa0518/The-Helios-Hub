import type { TopicRow } from '@/lib/explainers/types';

/**
 * The coverage map (planning/Explainer Reels/ideas-coverage/PLAN.md, approved 2026-11-03). Thirteen buckets of
 * idea categories, seven AI and six computer-science. Since the curriculum (2026-11-21) the syllabus (curriculum.ts)
 * assigns tonight's topics and sets the AI/CS mix; each idea still labels its bucket, and dedupe looks at a
 * candidate's own bucket. Concept lists are guidance only.
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
