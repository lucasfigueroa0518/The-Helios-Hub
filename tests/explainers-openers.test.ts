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
const STORYBOARD_FILE = 'STORYBOARD.md';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-openers-'));

// ── The pick (Lucas, 2026-10-19: never one of the last 8 reels' openers) ─────────────────────

test('the bank holds the ten openers Lucas kept, each with a score; Record Scratch is archived', () => {
  assert.deepEqual(OPENER_KEYS, ['paper-rip', 'typewriter', 'knock-knock', 'big-bang', 'eye-zoom', 'balloon-pop', 'block-drop', 'unboxing', 'paper-plane', 'scissors']);
  assert.equal(HISTORY, 8);
  for (const key of OPENER_KEYS) assert.ok((SCORES as Record<string, unknown>)[key], `${key} has a score`);
  assert.ok(!('record-scratch' in SCORES));
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
  assert.equal(pickOpener(['paper-rip', 'scissors', 'big-bang', 'knock-knock', 'eye-zoom', 'balloon-pop', 'block-drop', 'unboxing', 'typewriter'], { rand: () => 0.99, pool: ['typewriter', 'unboxing'] }), 'typewriter');
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

test('code writes frame 1: the chosen opener over the hook, no line and no events', () => {
  const root = project('scissors');
  const f = { number: 1, id: '01-opener', fields: {} };
  assert.ok(isBankOpener(root, f));
  assert.equal(storyboardTerm(root), 'agent loop');
  assert.equal(writeOpener(root, f), 'scissors');
  const module = fs.readFileSync(path.join(root, 'assets', 'frames', '01-opener.js'), 'utf8');
  assert.match(module, /import \* as hook from '\.\/01-hook\.js'/);
  assert.match(module, /openerFrame\("scissors", \{ hook, term: "agent loop" \}\)/);
  assert.equal(fs.readFileSync(path.join(root, 'assets', 'frames', '01-opener.events.json'), 'utf8').trim(), '[]');
  // no choice: frame 1 stays the worker's own (a job from before the bank)
  const legacy = project(null);
  assert.ok(!isBankOpener(legacy, f));
  assert.equal(writeOpener(legacy, f), null);
});

for (const key of OPENER_KEYS) {
  test(`${key}: draws over any hook and passes try.mjs`, () => {
    const root = project(key);
    const M = openerTiming(key);
    fs.writeFileSync(path.join(root, STORYBOARD_FILE), STORYBOARD.replace('- duration: 4.95s', `- duration: ${M.duration}s`));
    writeOpener(root, { number: 1, id: '01-opener' });
    const r = spawnSync('node', ['assets/kit/try.mjs', 'frame', '01-opener'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
}

test('an object-led reel: the hook needs no critter hero, and its openers never touch one (EX3-111)', async () => {
  const { OBJECT_HERO_OPENERS, OPENER_KEYS } = await import('../explainers/world-kit/openers/bank.js');
  // every opener draws over its own AI 101 card (its scholar, when it has one), never the reel's hero
  assert.deepEqual([...OBJECT_HERO_OPENERS].sort(), [...OPENER_KEYS].sort());
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
  const root = project('paper-rip');
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

test("the opener's sound: one stem on frame 1, the bed silent until the take-away, a sweep into the cut", { skip: !hasFfmpeg && 'ffmpeg is not installed' }, () => {
  const root = project('paper-rip');
  const M = openerTiming('paper-rip');
  fs.writeFileSync(path.join(root, STORYBOARD_FILE), STORYBOARD.replace('- duration: 4.95s', `- duration: ${M.duration}s`));
  tone(root, 'assets/bgm/track.mp3', 12);
  fs.writeFileSync(path.join(root, 'audio_meta.json'), JSON.stringify({ bgm: { path: 'assets/bgm/track.mp3', volume: 0.16 }, voices: [], sfx: [] }));
  const result = placeOpenerSfx(root);
  assert.equal(result.ok, true, result.errors.join('; '));
  const after = JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8'));
  assert.ok(hasOpenerSfx(after));
  assert.deepEqual(after.sfx.map((s: { role: string }) => s.role), ['opener-stem', 'opener-hit']);
  assert.equal(after.sfx[0].file, STEM);
  // the cut is a sweep that rushes into the 1→2 cut (never a second hit)
  assert.ok(after.sfx[1].offset_s < M.duration && after.sfx[1].offset_s >= M.duration - 0.5 - 1e-9, `sweep offset ${after.sfx[1].offset_s}`);
  assert.equal(after.bgm.path, OPENED_BED);
  assert.equal(after.bgm.source_path, 'assets/bgm/track.mp3');
  assert.ok(Math.abs(probe(path.join(root, STEM)) - M.duration) < 0.05);
  // the bed is silent before the take-away and plays after it
  const level = (from: number, len: number) => {
    const out = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(from), '-t', String(len), '-i', path.join(root, OPENED_BED), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    return Number(/max_volume: (-?[\d.]+|-inf) dB/.exec(out)?.[1] ?? -Infinity);
  };
  assert.ok(level(0, M.exitAt - 0.05) < -60, 'silent before the take-away');
  assert.ok(level(2, 1) > -30, 'playing after it');
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
  const earlier = ['typewriter', 'paper-rip', 'paper-plane', 'big-bang', 'knock-knock', 'eye-zoom', 'balloon-pop', 'block-drop', 'unboxing'];
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
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(objectWs, OPENER_CHOICE), 'utf8')), { key, name: openerByKey(key!)!.name, hero: 'object', voice: 'silent' });
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

/** A frame 2 stand-in that records the times it is drawn at. */
const stubNext = (seen: number[] = []) => ({ default: { ground: 'paper', shots: [], draw: (t: number) => { seen.push(t); return '<g data-next=""></g>'; } } });
const cardHook = async (key: string) => {
  const { lessonScene } = await import('../explainers/world-kit/openers/lesson.js');
  const scene = lessonScene(key);
  return { default: scene, hero: scene.hero };
};
const aiCount = (svg: string) => svg.split('data-text="AI 101"').length - 1;

// ── The hook before the voice (Lucas, 2026-11-21) ───────────────────────────────────────────

/** Whether "AI 101" is drawn in `svg` with no enclosing group faded below 0.99 opacity. */
function wordmarkShown(svg: string): boolean {
  const at = svg.indexOf('data-text="AI 101"');
  if (at < 0) return false;
  const open: string[] = [];
  for (const m of svg.slice(0, at).matchAll(/<g\b[^>]*?(\/?)>|<\/g>/g)) {
    if (m[0] === '</g>') open.pop();
    else if (!m[1]) open.push(m[0]);
  }
  return open.every((tag) => !/opacity="([\d.]+)"/.test(tag) || Number(/opacity="([\d.]+)"/.exec(tag)![1]) >= 0.99);
}

test('the hook: AI 101 and its icon whole for at least CARD_HOLD, the whole hook at most OPENER_MAX, always silent', async () => {
  const { OPENER_MAX, CARD_HOLD, ARCHIVED_OPENERS, hookRevealAt } = await import('../explainers/world-kit/openers/bank.js');
  assert.equal(OPENER_MAX, 1.0);
  assert.equal(CARD_HOLD, 0.4);
  assert.deepEqual(ARCHIVED_OPENERS, ['record-scratch']);
  for (const o of OPENERS) {
    const M = openerTiming(o.key);
    assert.equal(M.silent, true);
    assert.equal(M.voice, 0);
    assert.ok(M.cardIn >= 0 && M.cardIn < M.exitAt && M.exitAt < M.end, `${o.key}: cardIn < exitAt < end`);
    assert.ok(M.exitAt - M.cardIn >= CARD_HOLD - 1e-9, `${o.key}: the card holds ${(M.exitAt - M.cardIn).toFixed(2)}s`);
    assert.ok(M.end <= OPENER_MAX + 1e-9, `${o.key}: ${M.end}s`);
    assert.equal(M.duration, M.end);
    assert.equal(hookRevealAt(o.key), M.cardIn);
    // the score is on the same clock: every cue inside frame 1, the bed in on the take-away
    const { clips, bedAt } = openerScore(o.key, M);
    assert.ok(clips.every((c: { at: number }) => c.at >= 0 && c.at < M.duration), `${o.key}: a cue outside frame 1`);
    assert.ok(bedAt >= M.cardIn && bedAt < M.duration, `${o.key}: the bed comes in at ${bedAt}`);
  }
  assert.equal(openerTiming('typewriter').keys.length, 5, 'one strike per letter of AI 101');
  assert.throws(() => openerTiming('nope'), /no opener "nope"/);
});

test('the hook: AI 101 shows once, whole from cardIn to exitAt, and the opener lands on frame 2 at its own start', async () => {
  const { openerFrame } = await import('../explainers/world-kit/openers/index.js');
  for (const key of OPENER_KEYS) {
    const seen: number[] = [];
    const f = openerFrame(key, { hook: await cardHook(key), next: stubNext(seen) as never, term: 'MCP' });
    const M = openerTiming(key);
    for (let t = 0; t < M.duration; t += 1 / 30) {
      const svg = String(f.draw(t));
      assert.ok(!/NaN|undefined/.test(svg), `${key} at ${t.toFixed(2)}`);
      // once until the take-away; after it AI 101 is only the departing object (a torn sheet's two halves)
      if (t < M.exitAt) assert.ok(aiCount(svg) <= 1, `${key}: AI 101 drawn twice at ${t.toFixed(2)}s`);
      if (t >= M.cardIn && t < M.exitAt - 1e-6) assert.ok(wordmarkShown(svg), `${key}: AI 101 not whole at ${t.toFixed(2)}s`);
    }
    seen.length = 0;
    assert.match(String(f.draw(M.duration - 1 / 30)), /data-next=""/, `${key}: frame 2 is not under the last picture`);
    assert.ok(seen.length && seen.every((t) => t === 0), `${key}: frame 2 drawn at ${seen.join(', ')}`);
    // with no frame 2 it uncovers plain paper
    const bare = openerFrame(key, { hook: await cardHook(key), term: 'MCP' });
    assert.ok(!/NaN|undefined/.test(String(bare.draw(M.duration - 1 / 30))), key);
  }
});

test('the hook: code writes frame 1 over frame 2 with no line, and pace times it from the opener, the voice from frame 2', async () => {
  const { pace } = await import('../explainers/world-kit/pace.mjs');
  const root = project('big-bang');
  fs.writeFileSync(path.join(root, STORYBOARD_FILE), fs.readFileSync(path.join(root, STORYBOARD_FILE), 'utf8') + ['', '## Frame 2 — Define', '', '- duration: 3s', '- src: compositions/frames/02-define.html', '- ground: paper', ''].join('\n'));
  fs.writeFileSync(path.join(root, 'assets', 'frames', '02-define.js'), "export default { ground: 'paper', shots: [], draw: () => '<g></g>' };\n");
  writeOpener(root, { number: 1, id: '01-opener' });
  const module = fs.readFileSync(path.join(root, 'assets', 'frames', '01-opener.js'), 'utf8');
  assert.match(module, /import \* as next from '\.\/02-define\.js'/);
  assert.match(module, /openerFrame\("big-bang", \{ hook, next, term: "agent loop" \}\)/);
  // a frame-1 voice left over is dropped; frame 1 is the opener's own length, all of it hold
  const result = pace(root, { tighten: false });
  const M = openerTiming('big-bang');
  assert.deepEqual(result.frames.find((p: { frame: number }) => p.frame === 1), { frame: 1, voice: 0, hold: M.duration, duration: M.duration });
  assert.match(fs.readFileSync(path.join(root, STORYBOARD_FILE), 'utf8'), new RegExp(`- duration: ${M.duration}s`));
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8'));
  assert.ok(!meta.voices.some((v: { frame: number }) => v.frame === 1), 'no voice on frame 1');
});

test('silent hook: the opener stem mixes to the silent length with no frame-1 voice', { skip: !hasFfmpeg }, () => {
  const root = project('eye-zoom');
  fs.writeFileSync(path.join(root, CHOICE), JSON.stringify({ key: 'eye-zoom', voice: 'silent' }));
  fs.writeFileSync(path.join(root, 'audio_meta.json'), JSON.stringify({ bgm: null, voices: [], sfx: [] }));
  const M = openerTiming('eye-zoom', 0, [], { silent: true });
  fs.writeFileSync(path.join(root, 'STORYBOARD.md'), STORYBOARD.replace('- duration: 4.95s', `- duration: ${M.duration}s`));
  const placed = placeOpenerSfx(root);
  const stem = placed.sfx.find((s) => s?.role === 'opener-stem');
  assert.ok(stem, JSON.stringify(placed));
  assert.equal(stem!.duration_s, M.duration);
  const cut = placed.sfx.find((s) => s?.role === 'opener-hit')!.offset_s as number;
  assert.ok(cut < M.duration && cut >= M.duration - 0.5 - 1e-9, `the sweep rushes into the 1→2 cut (${cut})`);
});
