/**
 * The opener bank (EX3-102), offline: the pick that never repeats one of the last 8 reels'
 * openers, the timings, the opener's lead before frame 1's line, frame 1's module written by code,
 * every opener drawn over a stub hook through try.mjs, the opener's sound stem and the bed's drop,
 * and the render job's draw recorded on the job. No model, no HeyGen, no browser.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { HISTORY, OPENERS, OPENER_KEYS, openerByKey, openerTiming, pickOpener } from '../explainers/world-kit/openers/bank.js';
import { CHOICE, OPENED_BED, STEM, SCORES, openerLine, openerScore } from '../explainers/world-kit/openers/sound.mjs';
import { HOOK_ID, isBankOpener, storyboardTerm, writeOpener } from '../explainers/world-kit/frames.mjs';
import { hasOpenerSfx, placeOpenerSfx } from '../explainers/world-kit/opener-sfx.mjs';
import { leadVoice } from '../explainers/world-kit/pace.mjs';
import { assignOpener, OPENER_CHOICE } from '@/lib/explainers/render/job';
import { addTopics, getJob, recentOpeners, setJobOpener } from '@/lib/explainers/repository';

import { scratchExplainersDb } from './explainers-pglite';

const KIT = path.join(process.cwd(), 'explainers', 'world-kit');
const SFX = path.join(process.cwd(), 'explainers', 'design', 'sfx');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-openers-'));

// ── The pick (Lucas, 2026-10-19: never one of the last 8 reels' openers) ─────────────────────

test('the bank holds the eleven openers Lucas kept, each with a score', () => {
  assert.deepEqual(OPENER_KEYS, ['paper-rip', 'record-scratch', 'typewriter', 'big-bang', 'knock-knock', 'eye-zoom', 'balloon-pop', 'block-drop', 'unboxing', 'paper-plane', 'scissors']);
  assert.equal(HISTORY, 8);
  for (const key of OPENER_KEYS) assert.ok((SCORES as Record<string, unknown>)[key], `${key} has a score`);
});

test('a pick never repeats one of the last 8 openers, and every other opener can come up', () => {
  const recent = OPENER_KEYS.slice(0, 8);
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const key = pickOpener(recent);
    assert.ok(!recent.includes(key), `${key} was used in the last 8`);
    seen.add(key);
  }
  assert.deepEqual([...seen].sort(), OPENER_KEYS.slice(8).sort());
  // only the newest 8 count: the 9th-newest may come back
  assert.equal(pickOpener(['paper-rip', 'record-scratch', 'big-bang', 'knock-knock', 'eye-zoom', 'balloon-pop', 'block-drop', 'unboxing', 'typewriter'], { rand: () => 0.99, pool: ['typewriter', 'unboxing'] }), 'typewriter');
});

test('a run of picks with the history never repeats inside any 8 in a row', () => {
  const history: string[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200; i++) history.unshift(pickOpener(history, { rand }));
  for (let i = 0; i + 9 <= history.length; i++) {
    const window = history.slice(i, i + 9);
    assert.equal(new Set(window).size, 9, `reels ${i}..${i + 8}: ${window.join(', ')}`);
  }
});

test('when the pool is smaller than the history, the opener used longest ago comes back', () => {
  assert.equal(pickOpener(['big-bang', 'typewriter', 'paper-rip'], { pool: ['paper-rip', 'big-bang', 'typewriter'] }), 'paper-rip');
  assert.equal(pickOpener(['big-bang'], { pool: ['big-bang', 'typewriter'] }), 'typewriter');
  assert.throws(() => pickOpener([], { pool: ['nope'] }), /pool is empty/);
});

test("an opener's timing: its lead, the line, the hold; the freeze lifts on the line's \"this\"", () => {
  const words = [{ text: 'In', start: 0 }, { text: 'this', start: 1.4 }];
  const M = openerTiming('record-scratch', 3.8, words);
  assert.equal(M.voiceAt, 1);
  assert.equal(M.duration, 4.95);
  assert.equal(M.unfreezeAt, 2.4);
  assert.equal(openerTiming('typewriter', 3.8).keys.length, 12, 'one strike per letter of AI BRAIN BREAK');
  assert.equal(openerTiming('block-drop', 3.8).lands.length, 12, 'one block per letter');
  assert.throws(() => openerTiming('nope', 3), /no opener "nope"/);
  for (const o of OPENERS) {
    const { bedAt } = openerScore(o.key, openerTiming(o.key, 3.8, words));
    assert.ok(bedAt >= 0 && bedAt <= openerTiming(o.key, 3.8, words).duration, `${o.key}: the bed comes in during the opener`);
  }
});

// ── Frame 1 in a project ────────────────────────────────────────────────────

const STORYBOARD = [
  '---', 'format: 1080x1920', 'duration: 10s', 'term: agent loop', '---', '',
  '## Frame 1 — Series opener', '', '- duration: 4.95s', '- hold: 0.15s', '- transition_in: cut',
  '- src: compositions/frames/01-opener.html', '- ground: paper', '- type: hook', '',
].join('\n');

/** A hook to the contract, built from the kit only: a critter (the hero) beside a box. */
const HOOK = `
import { scope, el } from '../kit/draw.js';
import { frame } from '../kit/motion.js';
import { critter } from '../kit/cast.js';
export const shots = [{ at: 0, kind: 'medium', on: [540, 1000] }];
export const hero = { at: [420, 1300], s: 1.3, who: 'hero', critter: { body: 'orange', wear: ['cap'] } };
export default {
  ground: 'paper',
  shots,
  draw(t, { hideHero = false, heroPose = {} } = {}) {
    scope('f01h-', 'paper');
    const parts = [el('rect', { x: 600, y: 1100, width: 200, height: 200, fill: '#FF5E1A' })];
    if (!hideHero) parts.push(critter(420, 1300, { s: 1.3, body: 'orange', wear: ['cap'], who: 'hero', mood: t > 1 ? 'happy' : 'worried', ...heroPose }));
    return frame(t, {}, parts.join(''));
  },
};
`;

function project(key: string | null) {
  const root = tmp();
  fs.cpSync(KIT, path.join(root, 'assets', 'kit'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'frames'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'sfx'), { recursive: true });
  fs.copyFileSync(path.join(SFX, 'impact-bass-1.mp3'), path.join(root, 'assets', 'sfx', 'impact-bass-1.mp3'));
  fs.symlinkSync(SFX, path.join(root, 'assets', 'sfx-library'), 'dir');
  fs.writeFileSync(path.join(root, 'STORYBOARD.md'), STORYBOARD);
  fs.writeFileSync(path.join(root, 'assets', 'frames', `${HOOK_ID}.js`), HOOK);
  if (key) fs.writeFileSync(path.join(root, CHOICE), JSON.stringify({ key }));
  const words = [{ text: 'In', start: 0, end: 0.1 }, { text: 'this', start: 1.36, end: 1.5 }, { text: 'concept.', start: 3.4, end: 3.8 }];
  fs.writeFileSync(path.join(root, 'audio_meta.json'), JSON.stringify({ bgm: null, voices: [{ frame: 1, path: 'assets/voice/01.wav', duration_s: 3.8, words, lead_s: 0 }], sfx: [] }));
  return root;
}

test('code writes frame 1: the chosen opener over the hook, with the line baked in and no events', () => {
  const root = project('scissors');
  const f = { number: 1, id: '01-opener', fields: {} };
  assert.ok(isBankOpener(root, f));
  assert.equal(storyboardTerm(root), 'agent loop');
  assert.equal(writeOpener(root, f), 'scissors');
  const module = fs.readFileSync(path.join(root, 'assets', 'frames', '01-opener.js'), 'utf8');
  assert.match(module, /import \* as hook from '\.\/01-hook\.js'/);
  assert.match(module, /openerFrame\("scissors", \{ hook, voice: 3\.8, words: \[.*"this".*\], term: "agent loop" \}\)/);
  assert.equal(fs.readFileSync(path.join(root, 'assets', 'frames', '01-opener.events.json'), 'utf8').trim(), '[]');
  // no choice: frame 1 stays the worker's own (a job from before the bank)
  const legacy = project(null);
  assert.ok(!isBankOpener(legacy, f));
  assert.equal(writeOpener(legacy, f), null);
});

for (const key of OPENER_KEYS) {
  test(`${key}: draws over any hook, passes try.mjs, and its first text is "AI BRAIN BREAK" alone`, () => {
    const root = project(key);
    const M = openerTiming(key, 3.8, [{ text: 'this', start: 1.36 }]);
    fs.writeFileSync(path.join(root, 'STORYBOARD.md'), STORYBOARD.replace('- duration: 4.95s', `- duration: ${M.duration}s`));
    writeOpener(root, { number: 1, id: '01-opener' });
    const r = spawnSync('node', ['assets/kit/try.mjs', 'frame', '01-opener'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // the term never shows before the break is over: only in the title card, after it
    const probe = `
      await import('./assets/kit/try.mjs').catch(() => {});
      const scene = (await import('./assets/frames/01-opener.js')).default;
      const out = [];
      for (let t = 0; t < ${M.breakAt}; t += 0.05) out.push(String(scene.draw(t)).includes('data-role="title"'));
      console.log(JSON.stringify(out));`;
    const p = spawnSync('node', ['--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8' });
    const titles = JSON.parse(p.stdout.trim().split('\n').pop() || '[]') as boolean[];
    assert.ok(titles.length > 0 || M.breakAt === 0, p.stderr);
    assert.ok(titles.every((x) => !x), `${key}: the title card (with the term) is up before the break`);
  });
}

test('an object-led reel: the hook needs no critter hero, and its openers never touch one (EX3-111)', async () => {
  const { OBJECT_HERO_OPENERS, OPENER_KEYS } = await import('../explainers/world-kit/openers/bank.js');
  assert.deepEqual([...OBJECT_HERO_OPENERS].sort(), ['balloon-pop', 'big-bang', 'block-drop', 'paper-plane', 'paper-rip', 'typewriter', 'unboxing']);
  for (const key of OBJECT_HERO_OPENERS) {
    assert.ok(OPENER_KEYS.includes(key), key);
    const src = fs.readFileSync(path.join(KIT, 'openers', `${key}.js`), 'utf8');
    assert.doesNotMatch(src, /heroAt|heroCritter/, `${key} uses the hero`);
  }
  const root = project('paper-rip');
  fs.writeFileSync(path.join(root, CHOICE), JSON.stringify({ key: 'paper-rip', name: 'Paper Rip', hero: 'object' }));
  writeOpener(root, { number: 1, id: '01-opener' });
  // A hook with no hero export and no critter at all passes.
  fs.writeFileSync(path.join(root, 'assets', 'frames', `${HOOK_ID}.js`), HOOK.replace(/export const hero = .*\n/, '').replace(/if \(!hideHero\) parts\.push\(critter\([^\n]*\n/, ''));
  const r = spawnSync(process.execPath, ['assets/kit/try.mjs', 'frame', '01-opener'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(r.stdout, /must export `hero|hero "|does not draw its hero/, r.stdout);
  assert.equal(r.status, 0, r.stdout);
  // The same hook in a critter-led reel still needs its hero.
  fs.writeFileSync(path.join(root, CHOICE), JSON.stringify({ key: 'paper-rip' }));
  assert.match(spawnSync(process.execPath, ['assets/kit/try.mjs', 'frame', '01-opener'], { cwd: root, encoding: 'utf8' }).stdout, /must export `hero/);
});

test("try.mjs holds the hook to its contract: a hero, hidden on hideHero, no title card", () => {
  const root = project('paper-rip');
  writeOpener(root, { number: 1, id: '01-opener' });
  fs.writeFileSync(path.join(root, 'assets', 'frames', `${HOOK_ID}.js`), HOOK.replace(/export const hero = .*\n/, '').replace('if (!hideHero) ', ''));
  const r = spawnSync('node', ['assets/kit/try.mjs', 'frame', '01-opener'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /must export `hero/);
  fs.writeFileSync(path.join(root, 'assets', 'frames', `${HOOK_ID}.js`), HOOK.replace('if (!hideHero) ', ''));
  const r2 = spawnSync('node', ['assets/kit/try.mjs', 'frame', '01-opener'], { cwd: root, encoding: 'utf8' });
  assert.match(r2.stdout, /hideHero: true \}\) still draws its hero/);
  fs.rmSync(path.join(root, 'assets', 'frames', `${HOOK_ID}.js`));
  const r3 = spawnSync('node', ['assets/kit/try.mjs', 'frame', '01-opener'], { cwd: root, encoding: 'utf8' });
  assert.match(r3.stdout, /01-hook\.js does not exist/);
});

// ── The opener's lead and sound ─────────────────────────────────────────────

/** A 3.8s tone as frame 1's voice. */
function tone(root: string, file: string, seconds = 3.8) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds}`, path.join(root, file)]);
}
const probe = (file: string) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);

test("the opener's lead is silence before frame 1's line; its words move with it, once", { skip: !hasFfmpeg && 'ffmpeg is not installed' }, () => {
  const root = project('record-scratch');
  tone(root, 'assets/voice/01.wav');
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8'));
  const v = meta.voices[0];
  assert.equal(leadVoice(root, v, 1.0), null);
  assert.equal(v.lead_s, 1);
  assert.equal(v.duration_s, 4.8);
  assert.equal(v.words[1].start, 2.36);
  assert.ok(Math.abs(probe(path.join(root, v.path)) - 4.8) < 0.05);
  assert.equal(leadVoice(root, v, 1.0), null, 'a led voice is left alone');
  assert.equal(v.duration_s, 4.8);
  assert.deepEqual(openerLine({ voices: [v] })?.words[1], { text: 'this', start: 1.36, end: 1.5 });
});

test("the opener's sound: one stem on frame 1, the bed silent until the drop, the hit on the cut", { skip: !hasFfmpeg && 'ffmpeg is not installed' }, () => {
  const root = project('record-scratch');
  tone(root, 'assets/bgm/track.mp3', 12);
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8'));
  meta.bgm = { path: 'assets/bgm/track.mp3', volume: 0.16 };
  meta.voices[0].lead_s = 1;
  meta.voices[0].duration_s = 4.8;
  meta.voices[0].words = meta.voices[0].words.map((w: { start: number; end: number }) => ({ ...w, start: w.start + 1, end: w.end + 1 }));
  fs.writeFileSync(path.join(root, 'audio_meta.json'), JSON.stringify(meta));
  const result = placeOpenerSfx(root);
  assert.equal(result.ok, true, result.errors.join('; '));
  const after = JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8'));
  assert.ok(hasOpenerSfx(after));
  assert.deepEqual(after.sfx.map((s: { role: string }) => s.role), ['opener-stem', 'opener-hit']);
  assert.equal(after.sfx[0].file, STEM);
  assert.equal(after.sfx[1].offset_s, 4.95, 'the hit lands on the 1→2 cut');
  assert.equal(after.bgm.path, OPENED_BED);
  assert.equal(after.bgm.source_path, 'assets/bgm/track.mp3');
  assert.ok(Math.abs(probe(path.join(root, STEM)) - 4.95) < 0.05);
  // the bed is silent before the drop (the freeze lifts on "this": 1 + 1.36s) and plays after it
  const level = (from: number, len: number) => {
    const out = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(from), '-t', String(len), '-i', path.join(root, OPENED_BED), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    return Number(/max_volume: (-?[\d.]+|-inf) dB/.exec(out)?.[1] ?? -Infinity);
  };
  assert.ok(level(0.2, 1.5) < -60, 'silent before the drop');
  assert.ok(level(3, 1) > -30, 'playing after it');
  // run again: the same result, built from the original bed
  assert.equal(placeOpenerSfx(root).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8')).bgm.source_path, 'assets/bgm/track.mp3');
});

// ── The job's draw ──────────────────────────────────────────────────────────

test('a render job draws an opener none of the last 8 reels used, records it, and keeps it on resume', async () => {
  const { db } = await scratchExplainersDb();
  const [topic] = await addTopics(db, [{ title: 'What is an API?', origin: 'manual' }]);
  const newJob = async (status = 'ok') => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model)
       VALUES ($1, $2, 'click', 'development', 8, 'm', 'm') RETURNING id`,
      [topic.id, status],
    );
    return rows[0].id;
  };
  // nine earlier reels, newest last; a failed one never became a video and does not count
  const earlier = ['typewriter', 'paper-rip', 'record-scratch', 'big-bang', 'knock-knock', 'eye-zoom', 'balloon-pop', 'block-drop', 'unboxing'];
  for (const key of earlier) await setJobOpener(db, await newJob(), key);
  await setJobOpener(db, await newJob('failed'), 'scissors');
  const id = await newJob('running');
  assert.deepEqual(await recentOpeners(db, id, 8), [...earlier].reverse().slice(0, 8));

  const ws = tmp();
  const picks = new Set<string>();
  for (const r of [0, 0.5, 0.99]) {
    await db.query('UPDATE explainers.jobs SET opener = NULL WHERE id = $1', [id]);
    const key = await assignOpener(db, id, ws, { random: () => r });
    assert.ok(key && ['typewriter', 'paper-plane', 'scissors'].includes(key), `${key} was used in the last 8`);
    picks.add(key!);
    assert.equal((await getJob(db, id))?.opener, key);
    assert.equal(JSON.parse(fs.readFileSync(path.join(ws, OPENER_CHOICE), 'utf8')).key, key);
  }
  assert.ok(picks.size > 1, 'the pick is random');
  // An object-led reel draws only from the openers that never touch the hero (EX3-111), still never one
  // of the last 8, and the choice file says so.
  const { OBJECT_HERO_OPENERS } = await import('../explainers/world-kit/openers/bank.js');
  const objectJob = await newJob('ok');
  const objectWs = tmp();
  for (const r of [0, 0.5, 0.99]) {
    await db.query('UPDATE explainers.jobs SET opener = NULL WHERE id = $1', [objectJob]);
    const recent = await recentOpeners(db, objectJob, 8);
    const key = await assignOpener(db, objectJob, objectWs, { random: () => r, hero: 'object' });
    assert.ok(key && OBJECT_HERO_OPENERS.includes(key), `${key} touches the hero`);
    assert.ok(!recent.includes(key!) || OBJECT_HERO_OPENERS.every((k) => recent.includes(k)), `${key} was used in the last 8`);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(objectWs, OPENER_CHOICE), 'utf8')), { key, name: openerByKey(key!)!.name, hero: 'object' });
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(ws, OPENER_CHOICE), 'utf8')).hero, 'critter');
  // a resumed job keeps the opener it drew
  const kept = (await getJob(db, id))!.opener;
  assert.equal(await assignOpener(db, id, ws, { resuming: true, random: () => 0 }), kept);
  // a job resumed from before the bank keeps its worker's own frame 1 and draws none
  const legacyId = await newJob('ok');
  const legacy = tmp();
  fs.mkdirSync(path.join(legacy, 'assets', 'frames'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'assets', 'frames', '01-opener.js'), '// the worker\'s');
  assert.equal(await assignOpener(db, legacyId, legacy, { resuming: true }), null);
  assert.equal((await getJob(db, legacyId))?.opener ?? null, null);
  assert.ok(openerByKey('scissors'));
});

test('a database without the opener column still gets an opener (drawn without the history)', async () => {
  const { db } = await scratchExplainersDb();
  const [topic] = await addTopics(db, [{ title: 'What is a token?', origin: 'manual' }]);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model)
     VALUES ($1, 'running', 'click', 'development', 8, 'm', 'm') RETURNING id`,
    [topic.id],
  );
  await db.query('ALTER TABLE explainers.jobs DROP COLUMN opener');
  const ws = tmp();
  const key = await assignOpener(db, rows[0].id, ws, { random: () => 0 });
  assert.equal(key, 'paper-rip');
  assert.equal(JSON.parse(fs.readFileSync(path.join(ws, OPENER_CHOICE), 'utf8')).key, 'paper-rip');
  // resumed, it keeps the opener its workspace names
  assert.equal(await assignOpener(db, rows[0].id, ws, { resuming: true, random: () => 0.99 }), 'paper-rip');
});

test("the hook's shots run on frame 1's voice clock: after the drop every opener draws the hook at the frame's own t", async () => {
  const { openerFrame } = await import('../explainers/world-kit/openers/index.js');
  for (const key of OPENER_KEYS) {
    const seen: number[] = [];
    const hook = { default: { ground: 'paper', shots: [{ at: 0, kind: 'medium', on: [540, 1000] }], draw: (t: number) => { seen.push(t); return '<g data-hook=""></g>'; } }, hero: null };
    const f = openerFrame(key, { hook, voice: 3, words: [{ word: 'this', start: 0.4, end: 0.7 }], term: 'MCP' });
    const T = 5;
    seen.length = 0;
    try { f.draw(T); } catch { /* an opener that needs a critter hero is covered elsewhere */ }
    if (!seen.length) continue;
    assert.ok(seen.includes(T), `${key} drew the hook at ${seen.join(', ')} for frame time ${T}`);
  }
});
