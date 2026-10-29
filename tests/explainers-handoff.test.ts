import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  FALLBACK_HANDOFF,
  HANDOFF_HISTORY,
  HANDOFF_KEYS,
  HANDOFF_LINE,
  handoffEvents,
  handoffFits,
  handoffTiming,
  listField,
  pickHandoff,
} from '../explainers/world-kit/handoff-bank.js';
import { HANDOFF_LINE as LINT_HANDOFF_LINE } from '../explainers/lint/lint-storyboard.mjs';
import { eventProblems } from '../explainers/world-kit/sound.mjs';
import { chosenHandoff, isHandoff, parseFrames, writeHandoff } from '../explainers/world-kit/frames.mjs';
import { handoffPlan } from '@/lib/explainers/render/job';
import { CODING_TOPIC, openerLineFor } from '@/lib/explainers/render/workspace';

const fixture = fs.readFileSync(path.join(process.cwd(), 'explainers', 'lint', 'fixtures', 'good', 'STORYBOARD.md'), 'utf8');

test('4.3 hand-off bank: the nine approved directions, one line, every template fits what the reel has', () => {
  assert.deepEqual(HANDOFF_KEYS, ['glimpse-paper', 'glimpse-frosted', 'sound-pair', 'sound-steps', 'peek-critter', 'gather-slide', 'gather-drop', 'shine-once', 'shine-warm']);
  assert.equal(HANDOFF_LINE, "Let's dive into this in everyday terms.");
  assert.equal(LINT_HANDOFF_LINE, HANDOFF_LINE, 'one line in the lint and the kit');
  const bare = { critterHero: false, parts: [], sounds: [] };
  assert.ok(handoffFits(FALLBACK_HANDOFF, bare), 'the fallback needs nothing');
  assert.ok(!handoffFits('peek-critter', bare), 'peek-critter only with a critter hero');
  assert.ok(handoffFits('peek-critter', { ...bare, critterHero: true }));
  assert.ok(!handoffFits('gather-slide', { ...bare, parts: ['letter'] }), 'gather needs two mapped parts');
  assert.ok(handoffFits('gather-drop', { ...bare, parts: ['letter', 'flag'] }));
  assert.ok(!handoffFits('sound-steps', bare), 'sound templates need a world sound');
  assert.ok(handoffFits('sound-pair', { ...bare, sounds: ['door open'] }));
});

test('4.3 hand-off pick: random among the fitting templates, never one of the last few reels, never throws', () => {
  const reel = { critterHero: false, parts: [], sounds: [] };
  const fitting = HANDOFF_KEYS.filter((k) => handoffFits(k, reel));
  assert.deepEqual(fitting, ['glimpse-paper', 'glimpse-frosted', 'shine-once', 'shine-warm']);
  for (let i = 0; i < 20; i += 1) {
    const k = pickHandoff(['glimpse-paper', 'shine-once'], reel, { rand: () => i / 20 });
    assert.ok(['glimpse-frosted', 'shine-warm'].includes(k), k);
  }
  // Everything that fits was used recently: the one used longest ago.
  assert.equal(pickHandoff(['shine-warm', 'shine-once', 'glimpse-frosted', 'glimpse-paper'], reel, { rand: () => 0 }), 'glimpse-paper');
  // Only the last HANDOFF_HISTORY count.
  const older = ['sound-pair', 'sound-steps', 'gather-slide', 'gather-drop', 'glimpse-paper'];
  assert.equal(older.slice(0, HANDOFF_HISTORY).includes('glimpse-paper'), false);
  assert.equal(pickHandoff(older, reel, { rand: () => 0 }), 'glimpse-paper');
  assert.equal(pickHandoff(null as never, reel, { rand: () => 0.99 }), 'shine-warm');
});

test('4.3 hand-off sound: soft foley only, valid events, the world sounds on the beats', () => {
  for (const key of HANDOFF_KEYS) {
    for (const duration of [2.4, 3.2, 4.5]) {
      const events = handoffEvents(key, { duration, sounds: ['footstep', 'door open'], parts: 3 });
      assert.deepEqual(eventProblems(events, duration), [], `${key} ${duration}s`);
      assert.ok(events.every((e: { kind: string }) => e.kind === 'foley'), `${key}: no risers, impacts or stings`);
      assert.equal(events[0].what, 'pencil writing', 'the card writes itself');
    }
  }
  const pair = handoffEvents('sound-pair', { duration: 3.2, sounds: ['door open', 'door close'] }).map((e: { what: string }) => e.what);
  assert.deepEqual(pair, ['pencil writing', 'door open', 'door close', 'paper slide']);
  // No world sound: the template stays quiet where it would have used one.
  assert.deepEqual(handoffEvents('sound-steps', { duration: 3.2, sounds: [] }).map((e: { what: string }) => e.what), ['pencil writing', 'paper slide']);
  // The gather templates sound once per part they draw.
  assert.equal(handoffEvents('gather-slide', { duration: 3.2, parts: 2 }).filter((e: { what: string }) => e.what === 'paper slide').length, 3);
  const { HIT, write } = handoffTiming(3.2);
  assert.ok(HIT < 3.2 && write[1] < HIT);
});

test('4.3 hand-off plan: the hero, the mapped parts and the world sounds come from the storyboard', () => {
  assert.deepEqual(handoffPlan(fixture), { hero: { id: 'carrier', kind: 'critter' }, parts: ['mailbox', 'letter', 'flag'], sounds: ['footstep', 'creak'] });
  assert.deepEqual(handoffPlan('no blocks'), { hero: null, parts: [], sounds: [] });
  assert.deepEqual(listField('none'), []);
  assert.deepEqual(listField('`a`, "b"; c, d, e', 3), ['a', 'b', 'c']);
});

test('4.3 frame 3 is code\'s: writeHandoff writes the module and its events from assets/handoff.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
  fs.writeFileSync(path.join(root, 'STORYBOARD.md'), fixture);
  const f = parseFrames(fixture).find((x: { number: number }) => x.number === 3);
  assert.equal(f.id, '03-handoff');
  assert.equal(isHandoff(root, f), false, 'no choice: not code\'s');
  assert.equal(writeHandoff(root, f), null);
  fs.mkdirSync(path.join(root, 'assets', 'timing'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'handoff.json'), JSON.stringify({ key: 'gather-drop', parts: ['mailbox', 'letter'], sounds: ['footstep'], hero: { id: 'carrier', kind: 'critter' } }));
  fs.writeFileSync(path.join(root, 'assets', 'timing', '03-handoff.json'), JSON.stringify({ duration: 2.9 }));
  assert.equal(chosenHandoff(root).key, 'gather-drop');
  assert.ok(isHandoff(root, f));
  assert.equal(writeHandoff(root, f), 'gather-drop');
  const module = fs.readFileSync(path.join(root, 'assets', 'frames', '03-handoff.js'), 'utf8');
  assert.match(module, /import \* as world from '\.\.\/world\/world\.js';/);
  assert.match(module, /handoffFrame\("gather-drop", \{ world, \.\.\.\{"duration":2\.9,"term":"webhook"/);
  const events = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'frames', '03-handoff.events.json'), 'utf8'));
  assert.deepEqual(eventProblems(events, 2.9), []);
  // A choice the bank does not know: not code's.
  fs.writeFileSync(path.join(root, 'assets', 'handoff.json'), JSON.stringify({ key: 'fridge-note' }));
  assert.equal(chosenHandoff(root), null);
});

test('4.3 the hand-off draws the card on any world, and fails open with none', async () => {
  await import('../explainers/world-kit/try.mjs');
  const { handoffFrame } = await import('../explainers/world-kit/handoff.js');
  for (const key of HANDOFF_KEYS) {
    const frame = handoffFrame(key, { world: null, duration: 3.2, term: 'webhook', hero: { id: 'carrier', kind: 'critter' }, parts: ['letter', 'flag'] });
    for (const t of [0, 1.5, 3.1]) {
      const svg = frame.draw(t);
      assert.match(svg, /data-role="title"/, `${key} at ${t}s`);
    }
    assert.match(frame.draw(2.5), /webhook/, `${key}: the term is written by then`);
  }
  // A world with a room and one part: the gather template renders it.
  const world = {
    STATES: {},
    ROOM: () => ({ env: [], items: [] }),
    LENS: { letter: () => ({ id: 'letter', at: [0, 0, 0], svg: '<rect data-part="letter" width="10" height="10"/>' }), flag: () => ({ id: 'flag', at: [20, 0, 0], svg: '<rect data-part="flag" width="5" height="5"/>' }) },
    SIZES: { letter: { w: 20, d: 1, h: 10 } },
  };
  const gather = handoffFrame('gather-slide', { world, duration: 3.2, term: 'webhook', parts: ['letter', 'flag'] });
  assert.match(gather.draw(2.8), /data-part="letter"/);
});

test('4.3 opener line: AI, coding or tech, fitting the topic', () => {
  const ai = { jev_notes: { ai_focus: 3 }, title: 'How a coding assistant reads your repo' };
  assert.equal(openerLineFor(ai), 'In the next minute, this ___ will teach you an AI concept.', 'AI wins');
  assert.equal(openerLineFor({ jev_notes: { ai_focus: 1 }, title: 'Recursion', term: 'recursion' }), 'In the next minute, this ___ will teach you a coding concept.');
  assert.equal(openerLineFor({ jev_notes: { ai_focus: 1 }, title: 'What a git commit is' }), 'In the next minute, this ___ will teach you a coding concept.');
  assert.equal(openerLineFor({ jev_notes: { ai_focus: 1 }, title: 'How webhooks work', term: 'webhook' }), 'In the next minute, this ___ will teach you a tech concept.');
  assert.ok(!CODING_TOPIC.test('How DNS finds a website'));
});

test('4.3 gather hand-offs draw each critter once through the exit into the world (EX3-90)', async () => {
  const { castProblems } = await import('../explainers/world-kit/try.mjs');
  const { handoffFrame } = await import('../explainers/world-kit/handoff.js');
  const world = {
    STATES: {},
    ROOM: () => ({ env: [], items: [] }),
    LENS: {
      trainer: () => ({ id: 'trainer', at: [-40, 0, 0], svg: '<g data-who="trainer"><rect width="10" height="30"/></g>' }),
      puppy: () => ({ id: 'puppy', at: [40, 0, 0], svg: '<g data-who="puppy"><rect width="10" height="10"/></g>' }),
    },
    SIZES: { trainer: { w: 40, d: 30, h: 120 }, puppy: { w: 40, d: 20, h: 40 } },
  };
  for (const key of ['gather-slide', 'gather-drop']) {
    const frame = handoffFrame(key, { world, duration: 3.2, term: 'fine-tuning', parts: ['trainer', 'puppy'] });
    const samples = Array.from({ length: 65 }, (_, i) => ({ t: i * 0.05, svg: frame.draw(i * 0.05) }));
    assert.deepEqual(castProblems(samples).filter((e: string) => /drawn \d+ times/.test(e)), [], key);
    assert.match(frame.draw(3.2), /data-who="puppy"/, `${key}: the world stands at the end`);
  }
});
