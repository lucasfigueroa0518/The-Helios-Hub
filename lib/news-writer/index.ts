/**
 * news-writer@1: the shared News Writer for Morning Download and Last Few Days (W1–W12, WIRING-CONTRACT Owner C).
 *
 * One cached conversation per format (the lab's `writeDay`, scripts/news-writer.ts):
 *   1. blind: the writer proposes its own angle per story (propose_angles);
 *   2. reveal: the editor's (reranker's) angles, "(none)" where missing; the writer picks one and writes (write_stories);
 *   3. Haiku fact check; code verifies every supporting quote is really in the source;
 *   4. WC9: ONE rewrite turn covering failed facts and over-cap copy together; rewritten stories' facts are re-checked.
 *      Still unsupported → dropped with the reason. Still over cap → kept and listed in `over` (the renderer shrinks it).
 * A story missing from write_stories is dropped. Errors (no tool call) throw; the caller decides on a retry.
 *
 * Prompt text and tools are LOCKED (W12) and live in ./prompts. The client is injected (`deps.create`).
 * Revisions (the Social Hub's manual fixes): `o.instruction` adds one text block after the reveal, never a change to
 * the locked text; checkFacts runs step 3 alone on copy written elsewhere (a person's own words).
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withConversationCache, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { namesIn } from '@/lib/news-ranker/scores';
import type { WriterCreate } from '@/lib/stories/writer';

import { checkTool, FACT_CHECK_SYSTEM, FORMATS, proposeTool, WRITER_CORE, writeTool } from './prompts';

export { ANGLE_FIELD, FACT_CHECK_SYSTEM, FORMATS, WRITER_CORE } from './prompts';

export const WRITER_ID = 'news-writer@1';
export const WRITER_MODEL = 'claude-opus-5-5'; /* effort low */
export const CHECK_MODEL = 'claude-haiku-5-5';
const MAX_TOKENS = 8000;

export type Format = 'md' | 'lfd';
export type WriterStory = { key: string; headline: string; text: string; weAlreadySaid?: string | null };
export type Written = { key: string; chosen: 'mine' | 'editor'; angle: string; headline: string; body: string; highlight: string; names: string[] };

type Raw = { key: string; chosen: 'mine' | 'editor'; angle: string; headline: string; body: string; highlight?: string };
export type Claim = { key: string; claim: string; supported: boolean; evidence: string };

const toolUse = (m: Anthropic.Message, name: string): Anthropic.ToolUseBlock => {
  const b = m.content.find((x): x is Anthropic.ToolUseBlock => x.type === 'tool_use' && x.name === name);
  if (!b) throw new Error(`no ${name} call (stop: ${m.stop_reason})`);
  return b;
};

/** The stories as untrusted material; `we_already_said` (the earlier headline) only when set (FORMATS.md refers to it). */
export function material(stories: WriterStory[]): string {
  return `<material>\n${JSON.stringify(stories.map((s) => ({
    key: s.key, source_headline: s.headline, ...(s.weAlreadySaid ? { we_already_said: s.weAlreadySaid } : {}), text: s.text,
  })), null, 1)}\n</material>`;
}

export const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/** Evidence may join several quotes; every quoted piece (or the whole, if unquoted) must be in the source. */
const pieces = (e: string) => {
  const q = [...e.matchAll(/["“]([^"”]{8,})["”]/g)].map((x) => x[1]!);
  return (q.length ? q : [e]).flatMap((p) => norm(p).split(/\.\.\.|…/)).map((p) => p.trim()).filter((p) => p.length >= 8);
};

/** Claims that fail: not supported, or a supporting quote that is not really in the source (headline + text). */
export function failedClaims(stories: WriterStory[], claims: Claim[]): Claim[] {
  const src = new Map(stories.map((s) => [s.key, norm(`${s.headline} ${s.text}`)]));
  return claims.filter((c) => !c.supported || !pieces(c.evidence).every((p) => src.get(c.key)?.includes(p)));
}

/** WC10: words of namesIn(headline + body) that appear verbatim in the copy. */
export function namesFor(headline: string, body: string): string[] {
  const copy = `${headline} ${body}`;
  return [...namesIn(copy)].filter((w) => copy.includes(w));
}

/** The Haiku fact check's request (cached system + tool) over written copy, as writeStories sends it. */
function factCheckRequest(checked: WriterStory[], written: Array<{ key: string; headline: string; body: string }>): Record<string, unknown> {
  return { system: cachedSystemText(FACT_CHECK_SYSTEM), tools: [withToolCache(checkTool)],
    messages: [{ role: 'user', content: `${material(checked)}\n<written>\n${JSON.stringify(written.map((w) => ({ key: w.key, headline: w.headline, body: w.body })), null, 1)}\n</written>\nCheck every claim with check_facts.` }] };
}

function claimsOf(m: Anthropic.Message): Claim[] {
  const claims = (toolUse(m, 'check_facts').input as { claims?: Claim[] }).claims;
  if (!Array.isArray(claims)) throw new Error('fact check returned no claim list');
  return claims;
}

/**
 * The writer's fact check alone (one Haiku call, the request writeStories makes) over copy written elsewhere, such as
 * a person's own words in a revision. Returns the claims that fail; errors (no tool call) throw.
 */
export async function checkFacts(
  stories: WriterStory[],
  written: Array<{ key: string; headline: string; body: string }>,
  deps: { create: WriterCreate },
): Promise<{ failed: Claim[]; costUsd: number }> {
  const m = await deps.create({ model: CHECK_MODEL, max_tokens: MAX_TOKENS, ...factCheckRequest(stories, written) });
  return { failed: failedClaims(stories, claimsOf(m)), costUsd: Number(priceAnthropicMessages([m], { modelId: CHECK_MODEL }).costUsd) };
}

export async function writeStories(
  f: Format,
  stories: WriterStory[],
  editorAngles: Record<string, string>,
  deps: { create: WriterCreate },
  o: { instruction?: string } = {},
): Promise<{ written: Written[]; dropped: Array<{ key: string; reason: string }>; over: string[]; costUsd: number; log: string[] }> {
  const spent: Record<string, Anthropic.Message[]> = { [WRITER_MODEL]: [], [CHECK_MODEL]: [] };
  const log: string[] = [];
  const call = async (model: string, req: Record<string, unknown>) => {
    const m = await deps.create({ model, max_tokens: MAX_TOKENS, ...(model === WRITER_MODEL ? { output_config: { effort: 'low' } } : {}), ...req });
    spent[model]!.push(m);
    return m;
  };
  const cost = () => Object.entries(spent).reduce((sum, [model, ms]) => sum + (ms.length ? Number(priceAnthropicMessages(ms, { modelId: model }).costUsd) : 0), 0);
  if (!stories.length) return { written: [], dropped: [], over: [], costUsd: 0, log: ['no stories'] };

  const factCheck = async (checked: WriterStory[], written: Raw[]): Promise<Claim[]> =>
    failedClaims(checked, claimsOf(await call(CHECK_MODEL, factCheckRequest(checked, written))));

  const caps = FORMATS[f].caps;
  const overOf = (w: Raw) => [
    ...(w.headline.length > caps.headline ? [`headline ${w.headline.length} characters, cap ${caps.headline}`] : []),
    ...(w.body.length > caps.body ? [`body ${w.body.length} characters, cap ${caps.body}`] : []),
  ];

  // Turns 1–2: blind angles, then the reveal and the write.
  const system = cachedSystemText(WRITER_CORE + FORMATS[f].block);
  const tools = [proposeTool, withToolCache(writeTool(f))];
  const msgs: Anthropic.MessageParam[] = [{ role: 'user', content: `Propose your angle for each story.\n\n${material(stories)}` }];
  const t1 = await call(WRITER_MODEL, { system, tools, messages: withConversationCache(msgs) });
  const t1use = toolUse(t1, 'propose_angles');
  msgs.push({ role: 'assistant', content: t1.content }, { role: 'user', content: [
    { type: 'tool_result', tool_use_id: t1use.id, content: 'Received.' },
    { type: 'text', text: `Here are the editor's angles, written without seeing yours:\n${JSON.stringify(stories.map((s) => ({ key: s.key, angle: editorAngles[s.key] || '(none)' })), null, 1)}\nPick one per story, then write.` },
    // A revision's request: one added block after the locked text (absent for the builds).
    ...(o.instruction?.trim() ? [{ type: 'text' as const, text: o.instruction.trim() }] : []),
  ] });
  const t2 = await call(WRITER_MODEL, { system, tools, messages: withConversationCache(msgs) });
  const t2use = toolUse(t2, 'write_stories');
  const out = (t2use.input as { stories?: Raw[] }).stories ?? [];
  const byKey = new Map<string, Raw>();
  for (const w of out) if (w && stories.some((s) => s.key === w.key) && !byKey.has(w.key)) byKey.set(w.key, w);
  const dropped: Array<{ key: string; reason: string }> = [];
  for (const s of stories) if (!byKey.has(s.key)) { dropped.push({ key: s.key, reason: 'missing from write_stories' }); log.push(`${s.key}: missing from write_stories, dropped`); }
  const present = stories.filter((s) => byKey.has(s.key));

  // Fact check, then WC9's single combined rewrite turn.
  const failed = present.length ? await factCheck(present, [...byKey.values()]) : [];
  const failedKeys = new Set(failed.map((c) => c.key));
  const overKeys = new Set(present.filter((s) => overOf(byKey.get(s.key)!).length).map((s) => s.key));
  if (failedKeys.size || overKeys.size) {
    const lines: string[] = [];
    if (failed.length) lines.push(`These claims are not supported by the source:\n${failed.map((c) => `- ${c.key}: "${c.claim}" (${c.evidence})`).join('\n')}`);
    if (overKeys.size) lines.push(`These stories are over the length cap:\n${[...overKeys].map((k) => `- ${k}: ${overOf(byKey.get(k)!).join('; ')}`).join('\n')}`);
    log.push(`rewrite: facts [${[...failedKeys]}] over cap [${[...overKeys]}]`);
    msgs.push({ role: 'assistant', content: t2.content }, { role: 'user', content: [
      { type: 'tool_result', tool_use_id: t2use.id, content: 'Checks found problems.' },
      { type: 'text', text: `${lines.join('\n')}\nRewrite only those stories with write_stories. Keep each one's story and angle. Where a story is over the cap, cut words, never the detail that makes it land.` },
    ] });
    const t3 = await call(WRITER_MODEL, { system, tools, messages: withConversationCache(msgs) });
    const fixed = (toolUse(t3, 'write_stories').input as { stories?: Raw[] }).stories ?? [];
    const rewritten = new Set<string>();
    for (const w of fixed) if (w && byKey.has(w.key) && (failedKeys.has(w.key) || overKeys.has(w.key)) && !rewritten.has(w.key)) { byKey.set(w.key, w); rewritten.add(w.key); }
    // Re-check facts on the rewritten stories only; a failed story the writer did not return stays unsupported.
    const recheck = present.filter((s) => rewritten.has(s.key));
    const still = recheck.length ? await factCheck(recheck, recheck.map((s) => byKey.get(s.key)!)) : [];
    const stillByKey = new Map<string, Claim[]>();
    for (const c of still) stillByKey.set(c.key, [...(stillByKey.get(c.key) ?? []), c]);
    for (const k of failedKeys) if (!rewritten.has(k)) stillByKey.set(k, failed.filter((c) => c.key === k));
    for (const [k, cs] of stillByKey) {
      if (!byKey.has(k)) continue;
      const reason = `unsupported after rewrite: ${cs.map((c) => `"${c.claim}" (${c.evidence})`).join('; ')}`;
      byKey.delete(k);
      dropped.push({ key: k, reason });
      log.push(`${k}: ${reason}`);
    }
  }

  const written: Written[] = [];
  const over: string[] = [];
  for (const s of stories) {
    const w = byKey.get(s.key);
    if (!w) continue;
    const o = overOf(w);
    if (o.length) { over.push(s.key); log.push(`${s.key}: still over cap (${o.join('; ')}), kept`); }
    let highlight = '';
    if (f === 'lfd' && w.highlight) {
      if (w.headline.includes(w.highlight)) highlight = w.highlight;
      else log.push(`${s.key}: highlight "${w.highlight}" not in headline, cleared`);
    }
    written.push({ key: w.key, chosen: w.chosen === 'editor' ? 'editor' : 'mine', angle: w.angle ?? '', headline: w.headline, body: w.body, highlight, names: namesFor(w.headline, w.body) });
  }
  return { written, dropped, over, costUsd: cost(), log };
}
