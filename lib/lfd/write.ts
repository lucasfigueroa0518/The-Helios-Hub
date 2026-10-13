/**
 * One writing call for the whole post (spec §4.1), through the Social
 * structured call: cached tool + cached static system, the story material in
 * the user turn, a code check with one retry. Normalization fixes what code
 * can fix (dash, final period, highlight, setup count) instead of rejecting.
 */
import type { StageModelConfig } from '@/lib/social/pipeline/models';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { runStructuredCall } from '@/lib/social/writer/structured-call';

import { LFD_SYSTEM, LFD_TOOL } from './prompt';
import type { Pick, StoryCopy } from './types';

export { LFD_SYSTEM, LFD_TOOL };

export const LIMITS = { setup: 90, headline: 70, body: 190 } as const;
export const MAX_SETUPS = 2;
export const WRITER_MODEL: StageModelConfig = { model: 'claude-sonnet-5-5', effort: 'high' };
const SOURCE_CHARS = 9000;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Shape problems for one story; a story with any shape problem skips the length checks. */
function shapeProblems(s: Record<string, unknown>, label: string): string[] {
  const out: string[] = [];
  for (const field of ['key', 'setup', 'headline', 'highlight', 'body'] as const) {
    if (typeof s[field] !== 'string') out.push(`story ${label}: ${field} is missing or the wrong type`);
  }
  if (!isStringArray(s.names)) out.push(`story ${label}: names is missing or the wrong type`);
  const p = s.photo as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== 'object' || typeof p.kind !== 'string' || typeof p.query !== 'string' || !Array.isArray(p.subjects) || !Array.isArray(p.alts)) {
    out.push(`story ${label}: photo is missing or the wrong type`);
  }
  return out;
}

export function checkSubmission(input: unknown, keys: string[]): StoryCopy[] {
  const stories = (input as { stories?: unknown })?.stories;
  if (!Array.isArray(stories)) throw new Error('stories is missing');
  const problems: string[] = [];
  for (const key of keys) if (!stories.some((s) => (s as { key?: unknown } | null)?.key === key)) problems.push(`missing story ${key}`);
  for (const raw of stories) {
    if (!raw || typeof raw !== 'object') {
      problems.push('a story is not an object');
      continue;
    }
    const s = raw as StoryCopy;
    const shape = shapeProblems(raw as Record<string, unknown>, String((raw as { key?: unknown }).key));
    if (shape.length) {
      problems.push(...shape);
      continue;
    }
    const headline = s.headline.replace(/^[–-]\s*/, '');
    if (headline.length > LIMITS.headline) problems.push(`story ${s.key}: headline is ${headline.length} characters, the most is ${LIMITS.headline}`);
    if (s.body.length > LIMITS.body) problems.push(`story ${s.key}: body is ${s.body.length} characters, the most is ${LIMITS.body}`);
    if (s.setup && s.setup.length > LIMITS.setup) problems.push(`story ${s.key}: setup is ${s.setup.length} characters, the most is ${LIMITS.setup}`);
    if (s.setup && !s.setup.trim().endsWith(':')) problems.push(`story ${s.key}: setup must end with ":"`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return (stories as StoryCopy[]).filter((s) => keys.includes(s.key));
}

export function normalize(copies: StoryCopy[], rank: string[]): StoryCopy[] {
  const order = (k: string) => { const i = rank.indexOf(k); return i === -1 ? rank.length : i; };
  const setupKeys = new Set(
    copies.filter((s) => s.setup.trim()).sort((a, b) => order(a.key) - order(b.key)).slice(0, MAX_SETUPS).map((s) => s.key),
  );
  return copies.map((s) => {
    const headline = s.headline.replace(/^[–-]\s*/, '').trim();
    const highlight = s.highlight && headline.includes(s.highlight) ? s.highlight : '';
    return {
      ...s,
      headline,
      highlight,
      setup: setupKeys.has(s.key) ? s.setup.trim() : '',
      body: s.body.trim().replace(/\.+$/, ''),
      names: s.names.filter((n) => n.trim()),
    };
  });
}

export function materialFor(items: Array<{ pick: Pick; body: string }>): string {
  const stories = items.map(({ pick, body }) => ({
    key: pick.key,
    headline: pick.headline,
    outlet: pick.sourceName,
    also_reported_by: pick.alsoFrom,
    published: pick.publishedAt,
    url: pick.url,
    text: body.slice(0, SOURCE_CHARS),
  }));
  return `<material>\n${JSON.stringify({ stories }, null, 2)}\n</material>`;
}

export async function writeStories(
  create: MessagesCreate,
  items: Array<{ pick: Pick; body: string }>,
  note?: string,
): Promise<{ ok: true; stories: StoryCopy[]; costUsd: number } | { ok: false; detail: string; costUsd: number }> {
  const keys = items.map((i) => i.pick.key);
  const res = await runStructuredCall<StoryCopy[]>({
    create,
    config: WRITER_MODEL,
    system: LFD_SYSTEM,
    tool: LFD_TOOL,
    user: `${note ? `${note}\n\n` : ''}${materialFor(items)}`,
    check: (input) => checkSubmission(input, keys),
  });
  if (!res.ok) return { ok: false, detail: `${res.reason}: ${res.detail}`, costUsd: res.costUsd };
  return { ok: true, stories: normalize(res.value, keys), costUsd: res.costUsd };
}
