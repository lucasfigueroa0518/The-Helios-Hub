/** news-writer@1 offline: `create` is stubbed with canned tool_use responses. No live Anthropic calls. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { CHECK_MODEL, material, namesFor, WRITER_MODEL, writeStories, type WriterStory } from '@/lib/news-writer';
import { FORMATS, WRITER_CORE } from '@/lib/news-writer/prompts';

const msg = (name: string, input: unknown, id = `tu_${name}`): Anthropic.Message => ({
  id: `msg_${Math.random().toString(36).slice(2)}`, type: 'message', role: 'assistant', model: 'stub', stop_reason: 'tool_use', stop_sequence: null,
  content: [{ type: 'tool_use', id, name, input } as Anthropic.ToolUseBlock],
  usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as Anthropic.Usage,
} as Anthropic.Message);

type Params = Record<string, any>;
function stub(responses: Array<(p: Params) => Anthropic.Message>) {
  const calls: Params[] = [];
  const create = async (p: Record<string, unknown>) => {
    calls.push(structuredClone(p) as Params);
    const r = responses[calls.length - 1];
    if (!r) throw new Error(`unexpected call ${calls.length}`);
    return r(p as Params);
  };
  return { create, calls };
}

const STORIES: WriterStory[] = [
  { key: 'a1', headline: 'OpenAI ships a robot', text: 'OpenAI said its robot can fold laundry in 2 minutes. The company plans to sell it in March.' },
  { key: 'b2', headline: 'Google cuts prices', text: 'Google cut Gemini prices by 50% on Monday, according to a blog post.', weAlreadySaid: 'Google tests cheaper Gemini' },
];
const angles = { key: 'x', angles: [{ key: 'a1', angle: 'mine a' }, { key: 'b2', angle: 'mine b' }] };
const w = (key: string, headline: string, body: string, extra: Record<string, unknown> = {}) => ({ key, chosen: 'mine', angle: `angle ${key}`, headline, body, ...extra });
const good = [
  w('a1', 'OpenAI robot folds your laundry in 2 minutes', 'OpenAI plans to sell it in March.'),
  w('b2', 'Google halves what Gemini costs', 'The 50% cut came on Monday.', { chosen: 'editor' }),
];
const ok = (key: string, quote: string) => ({ key, claim: `claim ${key}`, supported: true, evidence: `"${quote}"` });
const okAll = { claims: [ok('a1', 'robot can fold laundry in 2 minutes'), ok('b2', 'cut Gemini prices by 50%')] };

test('two-turn flow: blind angles, reveal with (none) for a missing editor angle, write, clean check', async () => {
  const s = stub([() => msg('propose_angles', angles), () => msg('write_stories', { stories: good }), () => msg('check_facts', okAll)]);
  const r = await writeStories('md', STORIES, { a1: 'editor a' }, { create: s.create });
  assert.equal(s.calls.length, 3);
  const [t1, t2, ck] = s.calls;
  assert.equal(t1!.model, WRITER_MODEL);
  assert.deepEqual(t1!.output_config, { effort: 'low' });
  assert.equal(t1!.max_tokens, 8000);
  assert.equal(t1!.system[0].text, WRITER_CORE + FORMATS.md.block);
  assert.match(JSON.stringify(t1!.messages), /Propose your angle for each story/);
  assert.doesNotMatch(JSON.stringify(t1!.messages), /editor a/); // blind
  const reveal = t2!.messages[2].content.find((b: any) => b.type === 'text').text as string;
  assert.match(reveal, /^Here are the editor's angles, written without seeing yours:/);
  assert.match(reveal, /"angle": "editor a"/);
  assert.match(reveal, /"angle": "\(none\)"/);
  assert.equal(t2!.messages[2].content[0].type, 'tool_result');
  assert.equal(ck!.model, CHECK_MODEL);
  assert.equal(ck!.output_config, undefined);
  assert.deepEqual(r.written.map((x) => [x.key, x.chosen, x.highlight]), [['a1', 'mine', ''], ['b2', 'editor', '']]);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.over, []);
  assert.ok(r.costUsd > 0);
});

test('cache_control on system, last tool and the conversation tail', async () => {
  const s = stub([() => msg('propose_angles', angles), () => msg('write_stories', { stories: good }), () => msg('check_facts', okAll)]);
  await writeStories('md', STORIES, {}, { create: s.create });
  for (const c of s.calls) {
    assert.ok(c.system[0].cache_control, 'system cached');
    assert.ok(c.tools.at(-1).cache_control, 'last tool cached');
    assert.equal(c.tools.slice(0, -1).some((t: any) => t.cache_control), false);
  }
  const tail = s.calls[1]!.messages.at(-1).content.at(-1);
  assert.ok(tail.cache_control, 'conversation cache on the last block');
});

test('material adds we_already_said only when set', () => {
  const m = material(STORIES);
  assert.match(m, /"we_already_said": "Google tests cheaper Gemini"/);
  assert.equal((m.match(/we_already_said/g) ?? []).length, 1);
  assert.match(m, /^<material>\n/);
});

test('fabricated quote fails, one combined rewrite turn covers facts and over-cap, then passes', async () => {
  const longBody = 'x'.repeat(150);
  const first = [good[0], w('b2', 'Google halves what Gemini costs', longBody)];
  const s = stub([
    () => msg('propose_angles', angles),
    () => msg('write_stories', { stories: first }),
    () => msg('check_facts', { claims: [ok('a1', 'robot folds laundry in 90 seconds flat'), ok('b2', 'cut Gemini prices by 50%')] }), // a1 quote fabricated
    () => msg('write_stories', { stories: [w('a1', 'OpenAI robot folds laundry in 2 minutes', 'Sales start in March.'), w('b2', 'Google halves Gemini prices', 'The 50% cut came Monday.')] }),
    () => msg('check_facts', { claims: [ok('a1', 'robot can fold laundry in 2 minutes')] }),
  ]);
  const r = await writeStories('md', STORIES, {}, { create: s.create });
  assert.equal(s.calls.length, 5);
  const rewriteTurn = s.calls[3]!.messages.at(-1).content.find((b: any) => b.type === 'text').text as string;
  assert.match(rewriteTurn, /These claims are not supported by the source:\n- a1: "claim a1"/);
  assert.match(rewriteTurn, /These stories are over the length cap:\n- b2: body 150 characters, cap 140/);
  assert.match(rewriteTurn, /Rewrite only those stories with write_stories\. Keep each one's story and angle\. Where a story is over the cap, cut words, never the detail that makes it land\.$/);
  const recheck = s.calls[4]!.messages[0].content as string;
  assert.match(recheck, /"key": "a1"/);
  assert.match(recheck, /"key": "b2"/); // b2 was rewritten too, so it is re-checked
  assert.deepEqual(r.written.map((x) => x.headline), ['OpenAI robot folds laundry in 2 minutes', 'Google halves Gemini prices']);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.over, []);
});

test('still unsupported after the rewrite → dropped with reason; still over cap → kept and listed', async () => {
  const longHead = 'H'.repeat(70);
  const s = stub([
    () => msg('propose_angles', angles),
    () => msg('write_stories', { stories: [w('a1', 'OpenAI robot wins a gold medal', 'b'), w('b2', longHead, 'ok')] }),
    () => msg('check_facts', { claims: [{ key: 'a1', claim: 'gold medal', supported: false, evidence: 'source never mentions a medal' }, ok('b2', 'cut Gemini prices by 50%')] }),
    () => msg('write_stories', { stories: [w('a1', 'OpenAI robot wins silver', 'b'), w('b2', longHead, 'still ok')] }),
    () => msg('check_facts', { claims: [{ key: 'a1', claim: 'silver', supported: false, evidence: 'no medal at all' }, ok('b2', 'cut Gemini prices by 50%')] }),
  ]);
  const r = await writeStories('md', STORIES, {}, { create: s.create });
  assert.equal(s.calls.length, 5); // exactly one rewrite turn
  assert.deepEqual(r.written.map((x) => x.key), ['b2']);
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0]!.key, 'a1');
  assert.match(r.dropped[0]!.reason, /unsupported after rewrite: "silver" \(no medal at all\)/);
  assert.deepEqual(r.over, ['b2']);
});

test('a story missing from write_stories is dropped; a failed story left out of the rewrite stays dropped', async () => {
  const s = stub([
    () => msg('propose_angles', angles),
    () => msg('write_stories', { stories: [w('a1', 'OpenAI robot wins a medal', 'b')] }),
    () => msg('check_facts', { claims: [{ key: 'a1', claim: 'medal', supported: false, evidence: 'not in source' }] }),
    () => msg('write_stories', { stories: [] }),
  ]);
  const r = await writeStories('md', STORIES, {}, { create: s.create });
  assert.equal(s.calls.length, 4); // nothing rewritten, so no re-check
  assert.deepEqual(r.written, []);
  assert.deepEqual(r.dropped.map((d) => d.key).sort(), ['a1', 'b2']);
  assert.match(r.dropped.find((d) => d.key === 'b2')!.reason, /missing from write_stories/);
});

test('lfd: highlight kept when in the headline, write tool has highlight; names from code (WC10)', async () => {
  const lfd = [
    w('a1', 'OpenAI robot folds laundry in 2 minutes.', 'Sam Altman says sales start in March', { highlight: 'folds laundry' }),
    w('b2', 'Google halves Gemini prices.', 'The cut came Monday', { highlight: 'not there' }),
  ];
  const s = stub([() => msg('propose_angles', angles), () => msg('write_stories', { stories: lfd }), () => msg('check_facts', okAll)]);
  const r = await writeStories('lfd', STORIES, {}, { create: s.create });
  assert.equal(s.calls[0]!.system[0].text, WRITER_CORE + FORMATS.lfd.block);
  assert.ok(s.calls[0]!.tools.find((t: any) => t.name === 'write_stories').input_schema.properties.stories.items.properties.highlight);
  assert.equal(r.written[0]!.highlight, 'folds laundry');
  assert.equal(r.written[1]!.highlight, '');
  assert.deepEqual(r.written[0]!.names, ['OpenAI', 'Sam', 'Altman', 'March']);
  assert.deepEqual(r.written[1]!.names, ['Google', 'Gemini', 'Monday']);
});

test('namesFor drops stop words and keeps only words in the copy', () => {
  assert.deepEqual(namesFor('The AI lab Anthropic hires', 'New Claude model'), ['Anthropic', 'Claude']);
});
