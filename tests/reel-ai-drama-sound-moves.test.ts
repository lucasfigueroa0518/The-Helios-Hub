import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { cueMusicPlan, muffleEnvelope, musicEnvelope, ENV_RATE, SWELL_RISE } from '@/explainers/reel-ai-drama/kit/music.mjs';
import { STINGER_LIBRARY } from '@/explainers/reel-ai-drama/kit/sound.mjs';
import { designSound, soundLibrary, soundCuesTool, validateCues } from '@/lib/reel-ai-drama/render/sound-design';
import type { DirectorPlan, WriterDraft } from '@/lib/reel-ai-drama/types';

import { soundFixture } from './reel-ai-drama-sound-fixture';

const PROMPT = fs.readFileSync(path.join(process.cwd(), 'explainers/reel-ai-drama/prompts/sound-designer.md'), 'utf8');

test('a long swell climbs for its whole rise, and defaults to 3 seconds', () => {
  const plan = cueMusicPlan([{ t: 0, action: 'start', gain: 0.31 }, { t: 20, action: 'swell', gain: 0.45, dur: 10 }, { t: 30, action: 'swell', gain: 0.45 }], { total: 40 });
  assert.deepEqual(plan.swells.map((s) => s.rise), [10, 3]);
  const env = musicEnvelope({ segments: plan.segments, swells: plan.swells, speech: [{ start: 0, end: 40 }], total: 40 });
  const at = (x: number) => env[Math.round(x * ENV_RATE)];
  assert.ok(at(12) > at(9), 'it has started rising 8 seconds out');
  assert.ok(at(19.9) > at(15) && at(15) > at(12), 'and keeps climbing to the peak');
});

test('a swell rise stays in range', () => {
  const plan = cueMusicPlan([{ t: 0, action: 'start' }, { t: 30, action: 'swell', dur: 99 }], { total: 40 });
  assert.equal(plan.swells[0].rise, SWELL_RISE[1]);
});

test('muffleEnvelope holds for dur, opens on its anchor, and starts closed on the first instant', () => {
  const m = muffleEnvelope([{ t: 6, dur: 3 }, { t: 1.5, dur: 1.5 }], 10);
  const at = (x: number) => m[Math.round(x * ENV_RATE)];
  assert.equal(at(0), 1);
  assert.equal(at(1), 1);
  assert.equal(at(1.9), 0);
  assert.equal(at(3), 1);
  assert.equal(at(6), 1);
  assert.equal(at(6.5), 0);
});

test('every spot sound is in the catalog, so none silently disappears', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'explainers/design/sfx/catalog.json'), 'utf8')) as { id: string }[];
  const ids = new Set(catalog.map((c) => c.id));
  for (const e of STINGER_LIBRARY.spot) assert.ok(ids.has(e.id), e.id);
});

test('the prompt names every move the tool can play, with no story pollution', () => {
  for (const word of ['long build', 'Ramp and switch', 'The entrance', 'Muffle and open', 'held breath', 'The smash', 'The thing itself', '`spot`', '`muffle`']) {
    assert.ok(PROMPT.includes(word), word);
  }
  assert.doesNotMatch(PROMPT, /3-second rise|rises over the 3 seconds/);
});

const DRAFT = { title: 'T', lines: [] } as unknown as WriterDraft;
const PLAN = { frames: [] } as unknown as DirectorPlan;
const message = (input: unknown, stop: Anthropic.Message['stop_reason'] = 'tool_use') =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'tool_use', id: 't', name: 'submit_sound_cues', input }] }) as unknown as Anthropic.Message;

test('a plan that comes back empty is retried, and flagged when it fails again', async () => {
  const root = soundFixture();
  let calls = 0;
  const out = await designSound({ projectDir: root, draft: DRAFT, plan: PLAN }, { create: async () => { calls++; return message({}, 'max_tokens'); }, model: 'claude-sonnet-5-5' });
  assert.equal(calls, 2);
  assert.ok(out.problems.some((p) => /cut off, after a retry/.test(p) && !p.startsWith('warning:')), 'the flag reaches the job');
});

test('the tool offers swell length and muffles', () => {
  const root = soundFixture();
  const schema = soundCuesTool(soundLibrary(root)).input_schema as { properties: Record<string, { items: { properties: Record<string, unknown> } }> };
  assert.ok(schema.properties.music.items.properties.dur);
  assert.ok(schema.properties.muffles.items.properties.dur);
});

