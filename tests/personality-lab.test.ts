/** The comment bot, offline: a stubbed model (no live calls) checks routing, caching and the soft flags. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { flagsFor, postById, readSoul, replyBudget, runComment, type Create } from '@/lib/personality/lab';
import { REPLY_RULES, ROUTER_MODEL, ROUTER_SYSTEM, ROUTES, SILENT_ROUTES, WRITER_MODEL } from '@/lib/personality/prompts';
import { LAB_SAMPLE_COMMENTS } from '@/lib/personality/sample-comments';
import { LAB_POST_TYPES, LAB_POSTS, postsOfType } from '@/lib/personality/posts';

const post = LAB_POSTS[0]!;

const message = (name: string, input: Record<string, unknown>) => ({
  id: 'msg', model: 'stub', role: 'assistant', type: 'message', stop_reason: 'tool_use', stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
  content: [{ type: 'tool_use', id: 't', name, input }],
}) as unknown as Anthropic.Message;

/** Answers the router with `route`, and the writer with its tool's fields filled in. */
function stub(route: string, energy = 'medium', depth = 'short') {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create: Create = async (params) => {
    calls.push(params);
    const name = params.tools!.at(-1)!.name;
    if (name === 'submit_route') return message(name, { route, energy, depth, reason: 'stub' });
    if (name === 'submit_correction') return message(name, { verdict: 'unverified', reply: 'should be dropped' });
    return message(name, { reply: 'stub reply' });
  };
  return { calls, create };
}

for (const route of ['no_point', 'negative', 'controversial']) {
  test(`${route} gets no reply, and the writer is never called`, async () => {
    const { calls, create } = stub(route);
    const out = await runComment(create, { comment: 'whatever', post });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.model, ROUTER_MODEL);
    assert.equal(out.fields, null);
    assert.equal(out.decision.route, route);
  });
}

for (const [energy, laugh] of [['low', '😂'], ['medium', '😂😂'], ['high', '😂😂😂']] as const) {
  test(`a ${energy} energy joke gets ${laugh} and the writer is never called`, async () => {
    const { calls, create } = stub('joke', energy);
    const out = await runComment(create, { comment: 'my toaster is going to unionize', post });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.model, ROUTER_MODEL);
    assert.equal(out.fields!.reply, laugh);
  });
}

test('a question routes once, then writes with the route, energy and depth in the message', async () => {
  const { calls, create } = stub('question', 'high', 'long');
  const out = await runComment(create, { comment: 'where should i start?', post });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.model, WRITER_MODEL);
  // Sonnet 5.5 returns a 400 on a forced tool choice.
  assert.equal(calls[1]!.tool_choice?.type, 'auto');
  assert.match(String(calls[1]!.messages[0]!.content), /Route: question\nEnergy: high\nDepth: long/);
  assert.equal(out.fields!.reply, 'stub reply');
});

test('web search is offered on the question route only', async () => {
  const names = (c: Anthropic.MessageCreateParamsNonStreaming) => c.tools!.map((t) => t.name);
  const question = stub('question');
  await runComment(question.create, { comment: 'what does this cost?', post });
  assert.deepEqual(names(question.calls[1]!), ['web_search', 'submit_reply']);
  for (const route of ['opinion', 'correction']) {
    const other = stub(route);
    await runComment(other.create, { comment: 'something', post });
    assert.ok(names(other.calls[1]!).includes('web_search'), route);
  }
  for (const route of ['nice', 'agree', 'helios_question']) {
    const other = stub(route);
    await runComment(other.create, { comment: 'something', post });
    assert.ok(!names(other.calls[1]!).includes('web_search'), route);
  }
});

test('a correction the sources do not settle says nothing, even if the model wrote a reply', async () => {
  const { calls, create } = stub('correction');
  const out = await runComment(create, { comment: 'this number is wrong', post });
  assert.equal(calls[1]!.tools!.at(-1)!.name, 'submit_correction');
  assert.equal(out.fields!.verdict, 'unverified');
  assert.equal(out.fields!.reply, '');
});

test('the budget scales to the comment, and only long questions and corrections get room', () => {
  const short = { depth: 'short' } as const;
  assert.equal(replyBudget({ ...short, route: 'opinion' }, 'x'.repeat(80)), 120);
  assert.equal(replyBudget({ ...short, route: 'opinion' }, 'x'.repeat(10)), 60);
  assert.equal(replyBudget({ ...short, route: 'opinion' }, 'x'.repeat(900)), 280);
  assert.equal(replyBudget({ ...short, route: 'question' }, 'x'.repeat(20)), 60);
  assert.equal(replyBudget({ route: 'question', depth: 'long' }, 'x'.repeat(20)), 700);
  assert.equal(replyBudget({ ...short, route: 'correction' }, 'x'.repeat(20)), 200);
  assert.equal(replyBudget({ ...short, route: 'agree' }, 'x'.repeat(500)), 40);
});

/** A writer that answers with these replies in order, keeping a copy of what each call was sent. */
function scripted(replies: readonly string[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const queue = [...replies];
  const create: Create = async (params) => {
    calls.push({ ...params, messages: [...params.messages] });
    return message('submit_reply', { reply: queue.shift()! });
  };
  return { calls, create };
}

test('an over-budget reply goes back to be cut, and the shorter one is what comes out', async () => {
  const comment = 'x'.repeat(80);
  const { calls, create } = scripted([`${'y'.repeat(238)}?`, 'Short take. Short question?']);
  const out = await runComment(create, { comment, post, force: { route: 'opinion' } });
  assert.equal(calls.length, 2);
  assert.match(String(calls[0]!.messages[0]!.content), /Character budget: 120/);
  const feedback = calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.equal(feedback[0]!.type, 'tool_result');
  assert.match(String(feedback[0]!.content), /239 characters and the budget is 120/);
  assert.equal(out.fields!.reply, 'Short take. Short question?');
  assert.equal(out.rewrites, 1);
  assert.deepEqual(out.flags, []);
});

test('rewrites stop after two, and a reply still over budget is flagged', async () => {
  const comment = 'x'.repeat(80);
  const { calls, create } = scripted([`${'y'.repeat(200)}?`, `${'y'.repeat(180)}?`, `${'y'.repeat(150)}?`]);
  const out = await runComment(create, { comment, post, force: { route: 'opinion' } });
  assert.equal(calls.length, 3);
  assert.equal(out.rewrites, 2);
  assert.deepEqual(out.flags, ['reply is 151 chars, budget 120']);
});

test('a long answer that was asked for is not sent back', async () => {
  const { calls, create } = scripted(['y'.repeat(500)]);
  const out = await runComment(create, { comment: 'where do i start?', post, force: { route: 'question', depth: 'long' } });
  assert.equal(calls.length, 1);
  assert.equal(out.rewrites, 0);
});

test('a correction verdict with no search is flagged', async () => {
  const create: Create = async () => message('submit_correction', { verdict: 'post_is_right', reply: 'Reuters has it at 22%.' });
  const out = await runComment(create, { comment: 'this number is wrong', post, force: { route: 'correction' } });
  assert.deepEqual(out.flags, ['reached a verdict without searching']);
});

test('a search that pauses the turn continues, and the queries and sources come back', async () => {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const replies = [
    { ...message('x', {}), stop_reason: 'pause_turn', content: [
      { type: 'server_tool_use', id: 's', name: 'web_search', input: { query: 'bygga app price' } },
      { type: 'web_search_tool_result', tool_use_id: 's', content: [{ type: 'web_search_result', url: 'https://example.com/a', title: 'A' }] },
    ] },
    message('submit_reply', { reply: 'It is free.' }),
  ] as unknown as Anthropic.Message[];
  const create: Create = async (params) => { calls.push({ ...params, messages: [...params.messages] }); return replies.shift()!; };
  const out = await runComment(create, { comment: 'is it free?', post, force: { route: 'question' } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.messages.length, 2);
  assert.equal(calls[1]!.messages[1]!.role, 'assistant');
  assert.equal(out.fields!.reply, 'It is free.');
  assert.deepEqual(out.searches, ['bygga app price']);
  assert.deepEqual(out.sources, [{ url: 'https://example.com/a', title: 'A' }]);
});

test('a Helios question gets one public reply and no DM', async () => {
  const { calls, create } = stub('helios_question');
  const out = await runComment(create, { comment: 'how much do you charge?', post });
  assert.equal(calls[1]!.tools![0]!.name, 'submit_reply');
  assert.deepEqual(Object.keys(out.fields!), ['reply']);
});

test('a forced route skips the router', async () => {
  const { calls, create } = stub('nice');
  const out = await runComment(create, { comment: 'nice', post, force: { route: 'question', depth: 'long' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.model, WRITER_MODEL);
  assert.equal(out.decision.depth, 'long');
  assert.equal(out.decision.forced, true);
});

test('the voice and rules are the cached prefix, and per-request text stays out of it', async () => {
  const { calls, create } = stub('opinion');
  await runComment(create, { comment: 'my hot take', post, force: { route: 'opinion' }, avoid: ['an earlier reply'] });
  const system = calls[0]!.system as Anthropic.TextBlockParam[];
  assert.equal(system.length, 1);
  assert.ok(system[0]!.cache_control);
  assert.match(system[0]!.text, /SOUL: Helios/);
  assert.match(system[0]!.text, /Operating rules/);
  const copyInJson = JSON.stringify(post.copy).slice(1, -1);
  assert.ok(!system[0]!.text.includes(copyInJson) && !system[0]!.text.includes('my hot take'));
  const user = String(calls[0]!.messages[0]!.content);
  assert.ok(user.includes(copyInJson) && user.includes('<avoid>'));
});

test('a writer failure keeps the route and reports the error', async () => {
  let n = 0;
  const create: Create = async () => {
    if (n++ === 0) return message('submit_route', { route: 'nice', energy: 'low', depth: 'short', reason: 'stub' });
    throw new Error('boom');
  };
  const out = await runComment(create, { comment: 'love this', post });
  assert.equal(out.decision.route, 'nice');
  assert.equal(out.error, 'boom');
});

test('soft flags catch long replies, and an opinion reply with no question', () => {
  assert.deepEqual(flagsFor({ route: 'nice', depth: 'short' }, { reply: 'x'.repeat(41) }), ['reply is 41 chars, budget 40']);
  assert.deepEqual(flagsFor({ route: 'agree', depth: 'short' }, { reply: 'Thank you!' }), ['thanks them for something that was not about us']);
  assert.deepEqual(flagsFor({ route: 'agree', depth: 'short' }, { reply: 'Why do you say that?' }), ['agreement should not ask a question']);
  assert.deepEqual(flagsFor({ route: 'agree', depth: 'short' }, { reply: 'It really is.' }), []);
  assert.deepEqual(flagsFor({ route: 'nice', depth: 'short' }, { reply: '🔥' }, '🔥🔥🔥'), []);
  assert.deepEqual(flagsFor({ route: 'nice', depth: 'short' }, { reply: '🔥🔥' }, '🔥🔥🔥'), ['an emoji-only comment should get one emoji back']);
  assert.deepEqual(flagsFor({ route: 'nice', depth: 'short' }, { reply: 'Thanks!' }, '🔥🔥🔥'), ['an emoji-only comment should get one emoji back']);
  assert.deepEqual(flagsFor({ route: 'opinion', depth: 'short' }, { reply: 'Sure.' }), ['opinion reply asks no question']);
  assert.deepEqual(flagsFor({ route: 'question', depth: 'short' }, { reply: 'y'.repeat(161) }), ['reply is 161 chars, budget 160']);
  assert.deepEqual(flagsFor({ route: 'question', depth: 'long' }, { reply: 'y'.repeat(161) }), []);
  assert.deepEqual(flagsFor({ route: 'helios_question', depth: 'short' }, { reply: 'a — b' }), ['has an em dash']);
});

test('the bot sees the post copy and caption, and nothing else about the post', async () => {
  const { calls, create } = stub('opinion');
  const post = { ...LAB_POSTS[0]!, permalink: 'https://example.com/secret-link', date: '1999-01-01' };
  await runComment(create, { comment: 'hot take', post });
  for (const call of calls) {
    const user = String(call.messages[0]!.content);
    const seen = JSON.parse(/<post>(.*)<\/post>/s.exec(user)![1]!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(seen).sort(), ['caption', 'copy']);
    assert.ok(!user.includes('secret-link') && !user.includes('1999-01-01') && !user.includes(post.id));
  }
});

test('the seeds are real posts of every type, and explainers keep only the spoken lines', () => {
  for (const type of LAB_POST_TYPES) assert.ok(postsOfType(type).length > 0, type);
  assert.ok(LAB_POSTS.every((p) => p.copy.trim().length > 0));
  assert.equal(new Set(LAB_POSTS.map((p) => p.id)).size, LAB_POSTS.length);
  assert.ok(postsOfType('Explainers').every((p) => !p.copy.includes('**Voice') && !p.copy.includes('# SCRIPT')));
});

test('routing is one ordered list covering every route once, with a catch-all last and no quoted examples', () => {
  const steps = [...ROUTER_SYSTEM.matchAll(/^(\d+)\. ([a-z_]+):/gm)].map((m) => m[2]!);
  assert.deepEqual([...steps].sort(), [...ROUTES].sort());
  assert.equal(steps.at(-1), 'no_point');
  assert.ok(steps.indexOf('controversial') === 0);
  assert.ok(steps.indexOf('question') < steps.indexOf('negative'), 'a genuine skeptical question is not negative');
  assert.ok(steps.indexOf('correction') < steps.indexOf('negative'), 'a correction is looked up, not ignored');
  assert.ok(steps.indexOf('negative') < steps.indexOf('joke'), 'a sarcastic jab is not a joke');
  assert.ok(steps.indexOf('negative') < steps.indexOf('opinion'), 'a negative argument gets no reply');
  for (const text of [ROUTER_SYSTEM, REPLY_RULES]) assert.ok(!text.includes('"'), 'no quoted examples');
});

test('every written route has its reply rule, and silent routes and jokes have none', () => {
  for (const route of ['correction', 'helios_question', 'question', 'opinion', 'nice', 'agree']) assert.match(REPLY_RULES, new RegExp(`^- ${route}[,:]`, 'm'), route);
  for (const route of [...SILENT_ROUTES, 'joke']) assert.doesNotMatch(REPLY_RULES, new RegExp(`^- ${route}[,:]`, 'm'), route);
});

test('samples exist, and the voice file loads', () => {
  assert.ok(LAB_SAMPLE_COMMENTS.every((g) => g.comments.length > 0));
  assert.equal(postById('nope'), null);
  assert.match(readSoul(), /Unpretentious/);
});
