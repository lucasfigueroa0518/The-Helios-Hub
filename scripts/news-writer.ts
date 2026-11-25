/**
 * Shared News Writer, lab build (planning/MD-LFD Revisions/WRITER-DRAFT.md, W1–W7; Lucas approved 2026-11-23).
 * One writer for Morning Download and Last Few Days; only the Format block differs, and each format runs fresh.
 * v1 restored 2026-11-23 (Lucas on v2's reaction-first writer: "This was a step back. Restore the previous writing.");
 * v2 is kept for the record at .memes-local/news-ranker-lab/writer/news-writer-v2.ts.snapshot.
 *
 *   DAYS=2026-11-18 npx tsx scripts/news-writer.ts --yes   angles (Opus) + MD and LFD writers (Opus low) + fact check (Haiku)
 *
 * Lab: the reranker's angle comes from one Opus call per day with the reranker's own system prompt over the posted
 * stories (the production reranker gets the angle field in its grading call).
 */
import fs from 'node:fs';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withConversationCache, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { ANGLE_FIELD, FACT_CHECK_SYSTEM, FORMATS, WRITER_CORE, angleTool, checkTool, proposeTool, writeTool, type Format } from '@/lib/news-writer/prompts';

import { RERANK_SYSTEM } from './news-ranker-rerank';

// The locked prompt text and tools live in lib/news-writer/prompts.ts (production and lab share one copy).
export { ANGLE_FIELD, FACT_CHECK_SYSTEM, FORMATS, WRITER_CORE, type Format };

type Story = { key: string; headline: string; text: string };
type Written = { key: string; chosen: 'mine' | 'editor'; angle: string; headline: string; body: string; highlight?: string };
const OPUS = 'claude-opus-5-5', HAIKU = 'claude-haiku-5-5';
const client = new Anthropic();
const spent: Record<string, Anthropic.Message[]> = { [OPUS]: [], [HAIKU]: [] };

async function call(model: string, req: Omit<Anthropic.MessageCreateParamsNonStreaming, 'model' | 'max_tokens'>, effort?: 'low'): Promise<Anthropic.Message> {
  const m = await client.messages.create({ model, max_tokens: 8000, ...(effort ? { output_config: { effort } } : {}), ...req } as Anthropic.MessageCreateParamsNonStreaming);
  spent[model]!.push(m);
  return m;
}
const toolInput = <T>(m: Anthropic.Message, name: string): T => {
  const b = m.content.find((x): x is Anthropic.ToolUseBlock => x.type === 'tool_use' && x.name === name);
  if (!b) throw new Error(`no ${name} call (stop: ${m.stop_reason})`);
  return b.input as T;
};
const material = (stories: Story[]) => `<material>\n${JSON.stringify(stories.map((s) => ({ key: s.key, source_headline: s.headline, text: s.text })), null, 1)}\n</material>`;

/** The reranker's angles (lab stand-in: its own system prompt, posted stories only). */
async function editorAngles(stories: Story[]): Promise<Record<string, string>> {
  const m = await call(OPUS, { system: cachedSystemText(RERANK_SYSTEM), tools: [withToolCache(angleTool)],
    messages: [{ role: 'user', content: `These stories made today's post. Give each its angle with give_angles.\n\n${material(stories)}` }] }, 'low');
  return Object.fromEntries(toolInput<{ angles: { key: string; angle: string }[] }>(m, 'give_angles').angles.map((a) => [a.key, a.angle]));
}

/** One format's writer conversation: blind angles, reveal, write; one rewrite turn for failed facts. */
export async function writeDay(f: Format, stories: Story[], editor: Record<string, string>) {
  const system = cachedSystemText(WRITER_CORE + FORMATS[f].block);
  const tools = [proposeTool, withToolCache(writeTool(f))];
  const msgs: Anthropic.MessageParam[] = [{ role: 'user', content: `Propose your angle for each story.\n\n${material(stories)}` }];
  const t1 = await call(OPUS, { system, tools, messages: withConversationCache(msgs) }, 'low');
  const mine = toolInput<{ angles: { key: string; angle: string }[] }>(t1, 'propose_angles').angles;
  const t1use = t1.content.find((x): x is Anthropic.ToolUseBlock => x.type === 'tool_use')!;
  msgs.push({ role: 'assistant', content: t1.content }, { role: 'user', content: [
    { type: 'tool_result', tool_use_id: t1use.id, content: 'Received.' },
    { type: 'text', text: `Here are the editor's angles, written without seeing yours:\n${JSON.stringify(stories.map((s) => ({ key: s.key, angle: editor[s.key] })), null, 1)}\nPick one per story, then write.` },
  ] });
  const t2 = await call(OPUS, { system, tools, messages: withConversationCache(msgs) }, 'low');
  let written = toolInput<{ stories: Written[] }>(t2, 'write_stories').stories;
  const check = await factCheck(stories, written);
  let rewritten: string[] = [];
  if (check.failed.length) {
    const t2use = t2.content.find((x): x is Anthropic.ToolUseBlock => x.type === 'tool_use')!;
    msgs.push({ role: 'assistant', content: t2.content }, { role: 'user', content: [
      { type: 'tool_result', tool_use_id: t2use.id, content: 'Fact check found unsupported claims.' },
      { type: 'text', text: `These claims are not supported by the source:\n${check.failed.map((c) => `- ${c.key}: "${c.claim}" (${c.evidence})`).join('\n')}\nRewrite only those stories with write_stories, keeping their angle.` },
    ] });
    const t3 = await call(OPUS, { system, tools, messages: withConversationCache(msgs) }, 'low');
    const fixed = toolInput<{ stories: Written[] }>(t3, 'write_stories').stories;
    rewritten = fixed.map((x) => x.key);
    written = written.map((w) => fixed.find((x) => x.key === w.key) ?? w);
  }
  const caps = FORMATS[f].caps;
  return { mine: Object.fromEntries(mine.map((a) => [a.key, a.angle])), written, failed: check.failed, rewritten,
    over: written.filter((w) => w.headline.length > caps.headline || w.body.length > caps.body).map((w) => `${w.key} h${w.headline.length} b${w.body.length}`) };
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/** Haiku lists claims; code verifies each supporting quote is really in the source. */
async function factCheck(stories: Story[], written: Written[]) {
  const m = await call(HAIKU, { system: cachedSystemText(FACT_CHECK_SYSTEM), tools: [withToolCache(checkTool)],
    messages: [{ role: 'user', content: `${material(stories)}\n<written>\n${JSON.stringify(written.map((w) => ({ key: w.key, headline: w.headline, body: w.body })), null, 1)}\n</written>\nCheck every claim with check_facts.` }] });
  const claims = toolInput<{ claims: { key: string; claim: string; supported: boolean; evidence: string }[] }>(m, 'check_facts').claims;
  if (!Array.isArray(claims)) throw new Error('fact check returned no claim list');
  const src = new Map(stories.map((s) => [s.key, norm(`${s.headline} ${s.text}`)]));
  // Evidence may join several quotes; every quoted piece (or the whole, if unquoted) must be in the source.
  const pieces = (e: string) => {
    const q = [...e.matchAll(/["“]([^"”]{8,})["”]/g)].map((x) => x[1]!);
    return (q.length ? q : [e]).flatMap((p) => norm(p).split(/\.\.\.|…/)).map((p) => p.trim()).filter((p) => p.length >= 8);
  };
  const failed = claims.filter((c) => !c.supported || !pieces(c.evidence).every((p) => src.get(c.key)?.includes(p)));
  return { claims: claims.length, failed };
}

async function main() {
  if (!process.argv.includes('--yes')) return console.log('add --yes');
  const LAB = path.join(process.cwd(), '.memes-local/news-ranker-lab');
  const full = new Map<string, { headline: string; text: string }>();
  for (const f of ['days5.json', 'days-final3.json', 'days3.json', ...(process.env.EXTRA_DAYS ? [process.env.EXTRA_DAYS] : [])]) for (const s of JSON.parse(fs.readFileSync(path.join(LAB, 'tourney', f), 'utf8'))) full.set(s.storyId.slice(0, 8), s);
  const final = JSON.parse(fs.readFileSync(path.join(LAB, process.env.FINAL_JSON ?? 'md-trial/final.json'), 'utf8'));
  const out: Record<string, unknown> = {};
  const only = process.env.DAYS?.split(',');
  await Promise.all(Object.entries(final.days as Record<string, { posts: { id: string }[] }>).filter(([d]) => !only || only.includes(d)).map(async ([day, x]) => {
    const stories = x.posts.map((p) => ({ key: p.id, ...full.get(p.id)! })).filter((s) => s.text);
    const editor = await editorAngles(stories);
    const retry = async (f: Format) => { try { return await writeDay(f, stories, editor); } catch (e) { console.error(`${day} ${f} retry: ${e instanceof Error ? e.message : e}`); return writeDay(f, stories, editor); } };
    const mdOnly = process.env.FORMATS === 'md';
    const [md, lfd] = await Promise.all([retry('md'), mdOnly ? Promise.resolve({ written: [], failed: [], over: [], rewritten: [], mine: {} } as unknown as Awaited<ReturnType<typeof writeDay>>) : retry('lfd')]);
    out[day] = { stories: stories.map((s) => ({ key: s.key, source_headline: s.headline })), editor, md, lfd };
    console.log(`${day}: ${stories.length} stories; md picks editor ${md.written.filter((w) => w.chosen === 'editor').length}, lfd ${lfd.written.filter((w) => w.chosen === 'editor').length}; facts failed md ${md.failed.length} lfd ${lfd.failed.length}; over md [${md.over}] lfd [${lfd.over}]`);
  }));
  const cost = Number(priceAnthropicMessages(spent[OPUS]!, { modelId: OPUS }).costUsd) + Number(priceAnthropicMessages(spent[HAIKU]!, { modelId: HAIKU }).costUsd);
  const ledger = path.join(LAB, 'tourney/ledger.json');
  const l = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  l.spent += cost; l.runs.push({ spec: `news-writer v1${process.env.TAG ?? ''}`, cost, at: new Date().toISOString() });
  fs.writeFileSync(ledger, JSON.stringify(l, null, 1));
  fs.mkdirSync(path.join(LAB, 'writer'), { recursive: true });
  fs.writeFileSync(path.join(LAB, `writer/run${process.env.TAG ?? ''}-${only ? only.join('_') : 'all'}.json`), JSON.stringify({ costUsd: cost, days: out }, null, 1));
  console.log(`cost $${cost.toFixed(3)}`);
}
if (process.argv[1]?.endsWith('news-writer.ts')) main().catch((e) => { console.error(e); process.exitCode = 1; });
