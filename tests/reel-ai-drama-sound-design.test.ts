import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { designSound, soundLibrary, validateCues } from '@/lib/reel-ai-drama/render/sound-design';
import type { DirectorPlan, WriterDraft } from '@/lib/reel-ai-drama/types';

import { soundFixture } from './reel-ai-drama-sound-fixture';

const DRAFT = {
  title: 'The Dinner', engine: 'bomb', hook: { on_screen: 'A dinner', line_id: 'L1' },
  rungs: [
    { id: 'R1', purpose: 'setup', lines: [{ id: 'L1' }, { id: 'L2' }] },
    { id: 'R2', purpose: 'turn', lines: [{ id: 'L3' }] },
  ],
  turn_rung_id: 'R2', landing_rung_id: 'R2', close_question: 'Who was right?', word_count: 13,
} as unknown as WriterDraft;
const PLAN = { frames: [], lines_back: [] } as unknown as DirectorPlan;

/** The model's cues: a sound plan with deliberate mistakes the code must drop. */
const INPUT = {
  music: [
    { action: 'start', frame: 1, word: null, offset: 0, style: 'drone', gain: null, why: 'unease' },
    { action: 'resume', frame: 1, word: 1, offset: 0, style: null, gain: null, why: 'bad: already playing' },
    { action: 'swell', frame: 2, word: 2, offset: 0, style: null, gain: 0.3, why: 'the threat' },
    { action: 'change', frame: 3, word: 0, offset: 0, style: 'reflect', gain: null, why: 'the turn' },
    { action: 'cut', frame: 4, word: null, offset: 0, style: null, gain: null, why: 'button' },
  ],
  stingers: [
    { kind: 'riser', frame: 1, word: 3, offset: 0, dur: 1, id: null, gain: null, why: 'build' },
    { kind: 'hit', frame: 1, word: 3, offset: 0, dur: 0, id: 'pixabay/impact-bass-1', gain: null, why: 'hook' },
    { kind: 'hit', frame: 2, word: 0, offset: 0, dur: 0, id: null, gain: null, why: 'bad: too close' },
    { kind: 'hit', frame: 2, word: 2, offset: 0, dur: 0, id: 'nope/missing', gain: null, why: 'bad id' },
    { kind: 'silence', frame: 3, word: null, offset: -0.9, dur: 0.8, id: null, gain: null, why: 'before the turn' },
    { kind: 'silence', frame: 1, word: 1, offset: 0, dur: 0.5, id: null, gain: null, why: 'bad: over a word' },
    { kind: 'riser', frame: 2, word: 4, offset: 0, dur: 1.5, id: null, gain: null, why: 'bad: lands on nothing' },
    { kind: 'whoosh', frame: 3, word: 0, offset: 0, dur: 0.5, id: null, gain: null, why: 'the flip' },
    { kind: 'hit', frame: 9, word: 0, offset: 0, dur: 0, id: null, gain: null, why: 'bad frame' },
  ],
  ambience: [
    { from_frame: 1, to_frame: 2, id: 'freesound/ambience/room-tone-641306', gain: null, why: 'the hotel' },
    { from_frame: 2, to_frame: 3, id: 'freesound/ambience/office-108695', gain: 0.2, why: 'the office' },
    { from_frame: 1, to_frame: 1, id: 'freesound/ambience/nowhere', gain: null, why: 'bad id' },
  ],
};

function reply(input: unknown): Anthropic.Message {
  return {
    id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null,
    content: [{ type: 'tool_use', id: 'tu', name: 'submit_sound_cues', input }],
    usage: { input_tokens: 4000, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

test('designSound: one cached call, validated cues written, cost recorded, music re-laid', async () => {
  const root = soundFixture();
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const queries: unknown[][] = [];
  const db = { query: async (_sql: string, params: unknown[]) => { queries.push(params); return { rows: [], rowCount: 1 }; } };
  const out = await designSound({ projectDir: root, draft: DRAFT, plan: PLAN }, {
    create: async (p) => { calls.push(p); return reply(INPUT); },
    model: 'claude-sonnet-5-5', db: db as never, jobId: 'job-1', mode: 'production',
  });
  assert.equal(calls.length, 1);
  const p = calls[0];
  assert.equal(p.model, 'claude-sonnet-5-5');
  const system = p.system as Anthropic.TextBlockParam[];
  assert.ok(system[0].cache_control, 'system prefix is cached');
  assert.ok(system[0].text.includes('HARD CONSTRAINT') && system[0].text.includes('pixabay/riser'), 'prompt + library in the cached prefix');
  assert.ok((p.tools!.at(-1) as Anthropic.Tool).cache_control, 'tools are cached');
  const user = String(p.messages[0].content);
  assert.match(user, /Turn: frames 3/);
  assert.match(user, /\[3\] dinner @1\.2/);

  assert.ok(out.cues);
  const c = out.cues!;
  assert.deepEqual(c.music.map((m) => m.action), ['start', 'swell', 'change', 'cut']);
  assert.equal(c.music[0].t, 0);
  assert.equal(c.music[2].style, 'reflect');
  assert.equal(c.music[2].t, 6.2);
  assert.deepEqual(c.stingers.map((s) => `${s.kind}@${s.t}`), ['riser@1.2', 'hit@1.2', 'silence@5.1', 'whoosh@6.2']);
  assert.equal(c.ambience.length, 2);
  assert.equal(c.ambience[0].end, 3, 'the earlier bed ends where the next begins');
  const probs = out.problems.join('\n');
  for (const why of ['out of order', 'within 10s of the heavy hit', 'not a hit in the library', 'silence over a spoken word', 'resolves into nothing', 'not a frame/word', 'not an ambience bed']) {
    assert.ok(probs.includes(why), why);
  }
  const file = JSON.parse(fs.readFileSync(path.join(root, 'sound_cues.json'), 'utf8'));
  assert.deepEqual(Object.keys(file), ['music', 'stingers', 'ambience']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8')).bgm, null);
  assert.ok(out.usd > 0);
  assert.equal(queries.length, 1);
  assert.ok(queries[0].includes('sound_design'));
});

test('designSound fails open: an API error writes no cues', async () => {
  const root = soundFixture();
  const out = await designSound({ projectDir: root, draft: DRAFT, plan: PLAN }, {
    create: async () => { throw new Error('overloaded'); },
    model: 'claude-sonnet-5-5',
  });
  assert.equal(out.cues, null);
  assert.equal(out.usd, 0);
  assert.match(out.problems[0], /sound design failed.*overloaded/);
  assert.equal(fs.existsSync(path.join(root, 'sound_cues.json')), false);
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8')).bgm, 'music untouched');
});

test('designSound fails open with no tool call', async () => {
  const root = soundFixture();
  const msg = reply({});
  msg.content = [{ type: 'text', text: 'no', citations: null }] as never;
  const out = await designSound({ projectDir: root, draft: DRAFT, plan: PLAN }, { create: async () => msg, model: 'claude-sonnet-5-5' });
  assert.equal(out.cues, null);
  assert.equal(fs.existsSync(path.join(root, 'sound_cues.json')), false);
});

test('validateCues warns when the cold open has no bed or arc', () => {
  const root = soundFixture();
  const lib = soundLibrary(root);
  const clock = [{ number: 1, id: 'a', name: 'A', start: 0, duration: 20, fields: {}, words: [{ text: 'x', start: 0, end: 0.5 }] }];
  const reel = { clock, total: 20, closeStart: null, hookFrame: 1, turnFrames: [], landingFrames: [] };
  const { cues, problems } = validateCues({ music: [{ action: 'start', frame: 1, word: 0, offset: 2 }] }, reel, lib);
  assert.equal(cues.music.length, 1);
  assert.ok(problems.some((p) => p.includes('no music bed from frame 1')));
  assert.ok(problems.some((p) => p.includes('no riser-to-hit arc')));
});
