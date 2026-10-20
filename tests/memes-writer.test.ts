/**
 * Meme lab, meme-writer@3 (planning/Memes/UPGRADE_PLAN.md U1, U3, U4): turns
 * first, then memes from each turn's short list, with canned Claude
 * responses. No live call (CLAUDE.md Rule 1). The story is a test fixture,
 * not reporting.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { CARD_V2 } from '@/lib/memes/cards-v2';
import { TEMPLATE_CATALOG, writableSlots } from '@/lib/memes/catalog';
import { CostMeter } from '@/lib/memes/cost';
import { resolveMeme } from '@/lib/memes/fill';
import { shortlists, type Shortlist } from '@/lib/memes/match';
import { AUDIENCE_SITUATIONS } from '@/lib/memes/situations';
import { playersInStory, type MemeStory } from '@/lib/memes/story';
import { checkTurns, TURN_TYPES } from '@/lib/memes/turns';
import { checkMeme, slotCap, step2Message, WRITER_SYSTEM, writeMemes, writeMoreMemes, writerUser } from '@/lib/memes/writer';

import { cannedMessage, e, FIXTURE_BRIEF, FIXTURE_STORY, FREE, GOOD_MEMES, GOOD_TURNS, t, v, withPattern } from './fixtures/memes';

function scripted(responses: unknown[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error('no more canned responses');
    return cannedMessage(next);
  };
  return { create, calls };
}

/** The short lists, with This Is Fine also offered for T3 (the checks below use it). */
const listsFor = (story: MemeStory = FIXTURE_STORY, turns: unknown = GOOD_TURNS): Shortlist[] => {
  const lists = shortlists(checkTurns(turns, story).kept, { free: new Set(FREE), kind: 'single' }).lists;
  lists.find((l) => l.turn.id === 'T3')?.cards.push(TEMPLATE_CATALOG.find((c) => c.id === 'this-is-fine')!);
  return lists;
};
const FINE = withPattern({ turn_id: 'T3', template_id: 'this-is-fine', situation_id: null, relation: 'The free plan is capped and the company carries on.', fills: [t('fire', 'Free plan caps at 5 a day', ['F2']), e('sitter', 'perplexity')] });

test('prompt: the cached system prompt holds the rules, the turn types, every situation, the voice and the humanizer, and no story or card', () => {
  for (const tt of TURN_TYPES) assert.ok(WRITER_SYSTEM.includes(`- ${tt.id}: ${tt.what}`), tt.id);
  for (const s of AUDIENCE_SITUATIONS) assert.ok(WRITER_SYSTEM.includes(`- ${s.id} ${s.name}`), s.id);
  assert.match(WRITER_SYSTEM, /STEP 1: THE TURNS/);
  assert.match(WRITER_SYSTEM, /STEP 2: THE MEMES/);
  assert.match(WRITER_SYSTEM, /There is always an angle/);
  assert.match(WRITER_SYSTEM, /CLAIMS ARE CLAIMS/);
  assert.match(WRITER_SYSTEM, /Never with "says" or "claims"/);
  assert.match(WRITER_SYSTEM, /Confident, energetic, engaging/);
  assert.doesNotMatch(WRITER_SYSTEM, /Perplexity adds a daily limit/);
  assert.doesNotMatch(WRITER_SYSTEM, /- grus-plan: Gru's Plan/, 'cards go with the turns, per run');

  const user = writerUser(FIXTURE_STORY);
  assert.match(user, /F2: Free users get 5 deep searches a day\./);
  assert.match(user, /Step 1: name this story's turns/);
});

test('cards: every fillable slot has a MUST, and every card has its v2 fields (ME-102)', () => {
  for (const c of TEMPLATE_CATALOG) {
    for (const x of writableSlots(c)) assert.ok(x.must && x.must.length > 20, `${c.id}.${x.id}`);
    const v2 = CARD_V2[c.id];
    assert.ok(v2, c.id);
    assert.ok(v2.carries.length && v2.usage.length > 40 && v2.stance && v2.maxChars >= 20, c.id);
    assert.ok(c.slots.some((s) => s.id === v2.punch), `${c.id}: punch ${v2.punch} is a slot`);
    assert.ok(v2.beats[0] >= 1 && v2.beats[0] <= v2.beats[1], c.id);
    for (const s of v2.spoken ?? []) assert.ok(c.slots.some((x) => x.id === s), `${c.id}: spoken ${s}`);
  }
});

test('cards: every turn type is carried by at least three active templates, two of them picture-carried', () => {
  const active = TEMPLATE_CATALOG.filter((c) => !CARD_V2[c.id]!.benched);
  for (const tt of TURN_TYPES) {
    const carriers = active.filter((c) => CARD_V2[c.id]!.carries.includes(tt.id));
    assert.ok(carriers.length >= 3, `${tt.id}: ${carriers.length} carriers`);
    assert.ok(carriers.filter((c) => CARD_V2[c.id]!.carriedBy === 'picture').length >= 2, `${tt.id}: picture carriers`);
  }
  assert.deepEqual(TEMPLATE_CATALOG.filter((c) => CARD_V2[c.id]!.benched).map((c) => c.id).sort(), ['imagination-spongebob', 'laughing-leo', 'mocking-spongebob'], 'ME-103');
});

test('story: only the blue-chip players the brief names may go on a label', () => {
  assert.deepEqual(playersInStory(FIXTURE_BRIEF).map((p) => p.id), ['perplexity']);
});

test('turns: the checks name each problem; up to three are kept, strongest first, one per type', () => {
  const ok = checkTurns(GOOD_TURNS, FIXTURE_STORY);
  assert.deepEqual(ok.kept.map((x) => x.id), ['T1', 'T2', 'T3']);
  const bad = (over: Record<string, unknown>, beats?: unknown[]) => checkTurns({ turns: [{ ...GOOD_TURNS.turns[1], ...over, ...(beats ? { beats } : {}) }] }, FIXTURE_STORY).all[0]!.errors.join(' | ');
  assert.match(bad({ type: 'nope' }), /not a turn type/);
  assert.match(bad({}, [{ role: 'now', text: '5 a day', fact_ids: ['N1'], player_id: null }, { role: 'then', text: 'Free', fact_ids: ['F1'], player_id: null }]), /must follow the order/);
  assert.match(bad({}, [{ role: 'then', text: 'Free', fact_ids: ['F9'], player_id: null }, { role: 'now', text: '5', fact_ids: ['N1'], player_id: null }]), /fact "F9" is not in the brief/);
  assert.match(bad({}, [{ role: 'then', text: 'Free', fact_ids: ['F1'], player_id: null }, { role: 'now', text: 'Searches may be capped', fact_ids: ['F2'], player_id: null }]), /the payoff hedges/);
  assert.match(bad({}, [{ role: 'then', text: 'Free', fact_ids: ['F1'], player_id: 'openai' }, { role: 'now', text: '5', fact_ids: ['N1'], player_id: null }]), /openai is not in this story/);
  assert.match(bad({ type: 'viewers-day', touches_viewer: false }, [{ role: 'news', text: 'A cap', fact_ids: ['F1'], player_id: null }, { role: 'viewer', text: 'Me', fact_ids: [], player_id: null }]), /touches the viewer/);
  const claimStory: MemeStory = { ...FIXTURE_STORY, brief: { ...FIXTURE_BRIEF, facts: [...FIXTURE_BRIEF.facts!, { id: 'F4', text: 'Perplexity says its answers are the best.', sources: ['Fixture'], claim_by: 'Perplexity', notes: [] }] } };
  const claim = checkTurns({ turns: [{ ...GOOD_TURNS.turns[1], beats: [{ role: 'then', text: 'The best answers', fact_ids: ['F4'], player_id: null }, { role: 'now', text: '5 a day', fact_ids: ['N1'], player_id: null }] }] }, claimStory);
  assert.match(claim.all[0]!.errors.join(), /cast Perplexity/);
  const two = checkTurns({ turns: [GOOD_TURNS.turns[1], { ...GOOD_TURNS.turns[1], id: 'T9', strength: 3 }, GOOD_TURNS.turns[2], GOOD_TURNS.turns[0]] }, FIXTURE_STORY);
  assert.deepEqual(two.kept.map((x) => x.id), ['T9', 'T1', 'T3'], 'one per type first, strongest first');
});

test('writer: turns, then memes from the short lists; kept with their reasons; every prefix cached', async () => {
  const { create, calls } = scripted([GOOD_TURNS, { memes: GOOD_MEMES }]);
  const meter = new CostMeter();
  const r = await writeMemes({ create, story: FIXTURE_STORY, freeTemplates: FREE, meter });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(calls.length, 2);
  assert.equal(r.output.mappings.length, 6);
  assert.deepEqual(r.output.mappings.map((m) => m.turnId), ['T1', 'T1', 'T2', 'T2', 'T3', 'T3']);
  assert.equal(r.output.mappings[2]!.turnType, 'the-fall');
  assert.match(r.output.mappings[2]!.why.strong!, /strong is The free plan, before/);
  for (const c of calls) {
    assert.ok((c.system as Array<{ cache_control?: unknown }>)[0]!.cache_control, 'system cached');
    assert.equal(c.tools!.length, 2, 'both tools on every call, so the prefix stays the same');
    assert.ok((c.tools![1] as { cache_control?: unknown }).cache_control, 'tools cached');
    const last = c.messages.at(-1)!.content as Array<{ cache_control?: unknown }>;
    assert.ok(Array.isArray(last) && last.at(-1)!.cache_control, 'the conversation is cached on its last block');
  }
  assert.equal((calls[0] as { output_config?: { effort: string } }).output_config?.effort, 'medium', 'turns at medium effort');
  const step2 = JSON.stringify(calls[1]!.messages.at(-1));
  assert.match(step2, /tool_result/);
  assert.match(step2, /TURN T2 \(the-fall/);
  assert.match(step2, /- buff-doge-cheems: Buff Doge vs. Cheems/);
  assert.match(step2, /PUNCH slot: weak-caption/);
  assert.ok(Math.abs(meter.spent - r.costUsd) < 1e-12);
});

test('writer: turns that all fail get one retry asking for new ones, and the run is marked weak', async () => {
  const broken = { turns: [{ ...GOOD_TURNS.turns[1], beats: [{ role: 'then', text: 'Free', fact_ids: ['F9'], player_id: null }] }] };
  const { create, calls } = scripted([broken, GOOD_TURNS, { memes: GOOD_MEMES }]);
  const r = await writeMemes({ create, story: FIXTURE_STORY, freeTemplates: FREE, meter: new CostMeter(1) });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(calls.length, 3);
  assert.ok(r.output.weakTurn);
  assert.match(JSON.stringify(calls[1]!.messages.at(-1)), /viewer's-day turn/);
});

test('writer: no usable turn after the retry fails the run with the reasons', async () => {
  const broken = { turns: [{ ...GOOD_TURNS.turns[1], type: 'nope' }] };
  const { create, calls } = scripted([broken, broken]);
  const r = await writeMemes({ create, story: FIXTURE_STORY, freeTemplates: FREE, meter: new CostMeter() });
  assert.equal(!r.ok && r.reason, 'no-turns');
  assert.equal(calls.length, 2);
});

test('writer: broken memes are dropped with their errors; a memes call with nothing valid is sent back once (ME-84)', async () => {
  const broken = [
    { ...GOOD_MEMES[2], fills: [t('strong', 'The free plan, before', ['F9']), t('strong-caption', 'Deep searches', ['F1']), t('weak', 'Monday', ['F3']), t('weak-caption', '5 a day', ['N1'])] },
    { ...GOOD_MEMES[3], fills: [t('pain', '5 deep searches a day', ['N1']), e('smiler', 'openai')] },
    GOOD_MEMES[4],
  ];
  const a = scripted([GOOD_TURNS, { memes: broken }]);
  const r = await writeMemes({ create: a.create, story: FIXTURE_STORY, freeTemplates: FREE, meter: new CostMeter() });
  assert.ok(r.ok);
  assert.equal(r.output.mappings.length, 1);
  const errs = r.output.dropped.flatMap((d) => d.errors).join(' | ');
  assert.match(errs, /fact "F9" is not in the brief/);
  assert.match(errs, /OpenAI is not in this story/);
  const b = scripted([GOOD_TURNS, { memes: [broken[0]] }, { memes: GOOD_MEMES.slice(0, 2) }]);
  const r2 = await writeMemes({ create: b.create, story: FIXTURE_STORY, freeTemplates: FREE, meter: new CostMeter(1) });
  assert.ok(r2.ok);
  assert.equal(b.calls.length, 3);
  assert.equal(r2.output.mappings.length, 2);
});

test('more drafts: the follow-up continues the same conversation, says what failed, and asks for new memes (ME-95)', async () => {
  const { create, calls } = scripted([GOOD_TURNS, { memes: [GOOD_MEMES[0]] }, { memes: [GOOD_MEMES[2], GOOD_MEMES[4]] }]);
  const meter = new CostMeter(1);
  const first = await writeMemes({ create, story: FIXTURE_STORY, freeTemplates: FREE, meter });
  assert.ok(first.ok);
  const more = await writeMoreMemes({ create, story: FIXTURE_STORY, freeTemplates: FREE, meter, session: first.session, failed: ['running-away-balloon: judges: not accurate (0.40)'] });
  assert.ok(more.ok);
  assert.deepEqual(more.output.mappings.map((m) => m.templateId), ['buff-doge-cheems', 'types-of-headaches']);
  const sent = calls[2]!;
  assert.equal(sent.messages.length, 5, 'story, turns, short lists, memes, and the ask');
  const ask = JSON.stringify(sent.messages[4]);
  assert.match(ask, /tool_result/);
  assert.match(ask, /running-away-balloon: judges: not accurate/);
  assert.match(ask, /Write 4 new memes/);
  assert.equal(sent.max_tokens, 7000, 'the follow-up stops sooner');
});

test('writer: a call that could cross the spend cap is never made (ME-62)', async () => {
  const { create, calls } = scripted([GOOD_TURNS, { memes: GOOD_MEMES }]);
  const r = await writeMemes({ create, story: FIXTURE_STORY, freeTemplates: FREE, meter: new CostMeter(0.01) });
  assert.equal(!r.ok && r.reason, 'spend-cap');
  assert.equal(calls.length, 0);
});

test('step 2: the message lists each kept turn with its templates and every listed card in full', () => {
  const lists = listsFor();
  const msg = step2Message(lists, checkTurns(GOOD_TURNS, FIXTURE_STORY), []);
  assert.match(msg, /Write 6 memes: 2 per turn/);
  assert.match(msg, /Templates: running-away-balloon, waiting-skeleton, /);
  assert.match(msg, /WHY IT IS FUNNY: /, 'golden cards: the joke the format makes');
  assert.match(msg, /PATTERNS \(every meme on this card follows one/);
  assert.match(msg, /MISREADS/);
  assert.match(msg, /HARD CAP: \d+/);
});

test('check: short lists, viewers, hedges, narration, names, claims, voice and length each name their problem', () => {
  const lists = listsFor();
  const errs = (m: unknown, story: MemeStory = FIXTURE_STORY) => checkMeme(m, story, lists).errors.join(' | ');
  assert.equal(errs(GOOD_MEMES[0]), '');
  assert.match(errs({ ...GOOD_MEMES[2], template_id: 'grus-plan' }), /not on turn T2's short list/);
  assert.match(errs({ ...GOOD_MEMES[2], turn_id: 'T7' }), /not a kept turn/);
  assert.match(errs({ ...GOOD_MEMES[3], fills: [t('setup', 'Deep searches', ['F1']), t('pain', 'Capped', ['F2']), v('smiler', 'Me', 'AS-12')] }), /accepts|takes/);
  assert.match(errs({ ...FINE, fills: [t('fire', 'Searches may be capped', ['F2']), e('sitter', 'perplexity')] }), /"may" hedges/);
  assert.match(errs({ ...FINE, fills: [t('fire', 'Tell users about the cap', ['F2']), e('sitter', 'perplexity')] }), /narrates someone speaking/);
  assert.match(errs({ ...FINE, fills: [t('fire', 'Caps from Kozlowski', ['F2']), e('sitter', 'perplexity')] }), /"Kozlowski" is a name/);
  const cap = slotCap(TEMPLATE_CATALOG.find((c) => c.id === 'this-is-fine')!, 'fire');
  assert.match(errs({ ...FINE, fills: [t('fire', `Free plan caps at 5 a day${'y'.repeat(cap)}`, ['F2']), e('sitter', 'perplexity')] }), new RegExp(`at most ${cap}`));
  assert.match(errs({ ...FINE, fills: [t('fire', 'Capped at 5 a day!', ['F2']), e('sitter', 'perplexity')] }), /no exclamation marks/);
  const noWhy = { ...GOOD_MEMES[2], fills: GOOD_MEMES[2]!.fills.map((f) => ({ ...f, why: '' })) };
  assert.match(errs(noWhy), /why is empty/);
  const claimStory: MemeStory = { ...FIXTURE_STORY, brief: { ...FIXTURE_BRIEF, facts: [...FIXTURE_BRIEF.facts!, { id: 'F4', text: 'Perplexity says its answers are the best.', sources: ['Fixture'], claim_by: 'Perplexity', notes: [] }] } };
  const claimLists = listsFor(claimStory);
  const claimErrs = (m: unknown) => checkMeme(m, claimStory, claimLists).errors.join(' | ');
  assert.match(claimErrs({ ...GOOD_MEMES[4], fills: [t('worst', 'The best answers', ['F4'])] }), /put Perplexity on the image/);
  assert.equal(claimErrs({ ...FINE, fills: [t('fire', 'The best answers, capped', ['F4']), e('sitter', 'perplexity')] }), '', 'cast as the sitter, the claim is theirs');
  const personStory: MemeStory = { ...FIXTURE_STORY, brief: { ...FIXTURE_BRIEF, facts: [...FIXTURE_BRIEF.facts!, { id: 'F5', text: 'A recruiter says she can spot AI answers.', sources: ['Fixture'], claim_by: 'Jane Doe', notes: [] }] } };
  const personLists = shortlists(checkTurns(GOOD_TURNS, personStory).kept, { free: new Set(FREE), kind: 'single' }).lists;
  assert.equal(checkMeme({ ...GOOD_MEMES[4], fills: [t('worst', 'Recruiters spot AI answers', ['F5'])] }, personStory, personLists).errors.join(), '', 'only a blue-chip company has to be cast (ME-93); a person\'s claim goes to the accuracy judge');
});

test('check: a viewer line only for a turn that touches the viewer (ME-105); a situation on any other turn is dropped', () => {
  const lists = listsFor();
  const r = checkMeme({ ...FINE, situation_id: 'AS-04' }, FIXTURE_STORY, lists);
  assert.deepEqual(r.errors, []);
  assert.equal(r.mapping!.situationId, null);
  const t2 = lists.find((l) => l.turn.id === 'T2')!;
  t2.cards.push(TEMPLATE_CATALOG.find((c) => c.id === 'squidward-window')!);
  assert.match(checkMeme({ ...GOOD_MEMES[1], turn_id: 'T2' }, FIXTURE_STORY, lists).errors.join(), /needs a turn that touches the viewer/);
});

test('format lines: the writer fills only {x}, code prints the line, and writing the whole line is refused (ME-92)', () => {
  const lists = listsFor();
  lists[0]!.cards.push(TEMPLATE_CATALOG.find((c) => c.id === 'anakin-padme')!);
  const anakin = (hope: string) => withPattern({ turn_id: 'T1', template_id: 'anakin-padme', situation_id: null, relation: 'r', fills: [t('announcement', 'A daily limit on the free plan'), t('hope', hope)] });
  const ok = checkMeme(anakin('Only for heavy users'), FIXTURE_STORY, lists);
  assert.deepEqual(ok.errors, []);
  const items = resolveMeme(ok.mapping!.fill).items;
  const text = (slot: string) => (items.find((i) => i.slot === slot)!.content as { text: string }).text;
  assert.equal(text('hope'), 'Only for heavy users, right?');
  assert.equal(text('doubt'), 'Only for heavy users, right?', 'the last panel repeats the question, by code');
});
