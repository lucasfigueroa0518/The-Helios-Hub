/**
 * Iteration 12, Part A: each failure class in ITERATION-12-ALIGN §1, simulated offline, behaving as stated. No network, no model, no
 * voice: every vendor is a stub. Where a class needs a whole run, it goes through runJob on the real tables (PGlite).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkDesign } from '@/lib/reel-ai-drama/checks/design';
import { checkFirstViewer } from '@/lib/reel-ai-drama/checks/first-viewer';
import type { Queryable } from '@/lib/explainers/db';
import { localArtifactStore } from '@/lib/explainers/storage';
import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { claimNextJob, failStaleJobs, finishJob, getJob, listArtifacts, requeueJob, requestJob } from '@/lib/reel-ai-drama/production/jobs';
import { runJob, type ProductionDeps } from '@/lib/reel-ai-drama/production/run';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { DirectorPlan, FactSheet, HookChoice, Pitch, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { heygenWallet, preflight } from '@/lib/reel-ai-drama/production/preflight';
import { appendStepLog, holdAwake, readStepLog, tail, type RunResult, type Runner } from '@/lib/reel-ai-drama/render/runner';
import { GSAP_FILE, localizeGsap, renderVideo } from '@/lib/reel-ai-drama/render/video';
import { missingVoices, runVoice } from '@/lib/reel-ai-drama/render/voice';
import { scratchExplainersDb } from './explainers-pglite';
import { errorReason, failureClass, isConnectionLoss, isRefusal, isTransient, resilientDb, waitForNetwork, withRetry, type NetworkWatch } from '@/lib/reel-ai-drama/retry';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rd-iter12-'));
const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });

/** A network that's down for `downPolls` probes, then back. Never sleeps. */
function outage(downPolls: number): Partial<NetworkWatch> & { events: string[] } {
  let left = downPolls;
  const events: string[] = [];
  return { events, probe: async () => left-- <= 0, sleep: async () => undefined, pollMs: 1, onWait: (e) => void events.push(e) };
}

const SCRIPT = ['## One (Frame 1)', '    First line here.', '', '## Two (Frame 2)', '    Second line here.', '', '## Three (Frame 3)', '    Third line here.', ''].join('\n');
const WORDS = 'First line here. Second line here. Third line here.'.split(' ').map((text, i) => ({ id: `w${i}`, text, start: i * 0.5, end: i * 0.5 + 0.4 }));

/** A voice step's fake machine: the take, the engine, and the local tools, each overridable. */
function voiceProject(answers: { take?: (args: string[], n: number) => RunResult | null; engine?: () => RunResult } = {}) {
  const project = tmp();
  fs.writeFileSync(path.join(project, 'SCRIPT.md'), SCRIPT);
  const write = (rel: string, body = 'wav') => {
    fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
    fs.writeFileSync(path.join(project, rel), body);
  };
  const takes: string[][] = [];
  const paces: string[] = [];
  const run: Runner = (cmd, args) => {
    if (args[0]?.endsWith('heygen-tts.mjs')) {
      takes.push(args);
      const refused = answers.take?.(args, takes.length);
      if (refused) return refused;
      write(args[args.indexOf('-o') + 1]!);
      write(args[args.indexOf('--words') + 1]!, JSON.stringify(/frame-/.test(args[1]!) ? WORDS.slice(0, 3) : WORDS));
      return ok();
    }
    if (args[0]?.endsWith('audio.mjs') && !args.includes('sync-durations')) return answers.engine?.() ?? ok();
    if (args[0] === 'assets/kit/pace.mjs') paces.push('pace');
    if (cmd === 'ffprobe') return ok('2.000\n');
    if (cmd === 'ffmpeg' && args.some((a) => a.startsWith('silencedetect'))) return { status: 0, stdout: '', stderr: '' };
    if (cmd === 'ffmpeg') write(path.relative(project, path.resolve(project, args[args.length - 1]!)));
    return ok();
  };
  return { project, run, takes, paces, write };
}
const quick = { waitMs: 0 };

// ── Say why ─────────────────────────────────────────────────────────────────

test('say why: the real message survives however much output comes after it', () => {
  const res: RunResult = { status: 255, stdout: '', stderr: `Error: ffmpeg audio mix: Invalid argument in filter\n${'frame=1 progress\n'.repeat(500)}done` };
  const text = tail(res);
  assert.match(text, /Invalid argument in filter/, 'the tail alone hid it every time');
  assert.match(text, /done$/);
  assert.ok(text.length < 2600);
  assert.match(tail({ status: null, stdout: '', stderr: 'partial', signal: 'SIGKILL' }), /killed by SIGKILL/);
  assert.match(tail({ status: null, stdout: '', stderr: 'partial', error: 'spawnSync x ETIMEDOUT' }), /ETIMEDOUT[\s\S]*partial/, 'a timeout keeps the output too');
});

test('say why: an error in words keeps its cause, and a harness bug says where it threw', () => {
  assert.match(errorReason(Object.assign(new Error('Connection error.'), { cause: { message: 'getaddrinfo failed', code: 'ENOTFOUND' } })), /Connection error\. \(cause: getaddrinfo failed ENOTFOUND\)/);
  try {
    (undefined as unknown as { length: number }).length;
  } catch (bug) {
    assert.match(errorReason(bug), /reading 'length'.*\[at /);
  }
});

test('say why: a render failure keeps its whole output with the project', async () => {
  const project = tmp();
  fs.writeFileSync(path.join(project, 'index.html'), '');
  const noise = 'x'.repeat(5_000);
  const run: Runner = () => ({ status: 255, stdout: noise, stderr: 'Audio mix: ffmpeg exited 255\nthe real reason' });
  await assert.rejects(renderVideo(project, { run, bin: 'hf' }), /exited 255[\s\S]*Audio mix/);
  assert.match(readStepLog(project)!, /the real reason/);
  assert.ok(readStepLog(project)!.includes(noise));
});

// ── Check before paying ─────────────────────────────────────────────────────

const preflightInput = (send: typeof fetch, over: Partial<Parameters<typeof preflight>[0]> = {}) => ({
  secrets: { anthropicApiKey: 'a', heygenApiKey: 'h' },
  jobsRoot: tmp(),
  run: (() => ok()) as Runner,
  fetcher: send,
  network: outage(0),
  hyperframesBin: GSAP_FILE,
  freeBytes: () => 100 * 1024 ** 3,
  ...over,
});
const replies = (heygen: Response | Error, anthropic: Response = new Response('{}')): typeof fetch =>
  (async (url: string | URL | Request) => {
    if (String(url).includes('heygen')) {
      if (heygen instanceof Error) throw heygen;
      return heygen.clone();
    }
    return anthropic.clone();
  }) as typeof fetch;
const wallet = (remaining_balance: number) => new Response(JSON.stringify({ data: { billing_type: 'wallet', wallet: { currency: 'usd', remaining_balance } } }));

test('preflight: a $0 voice wallet stops the job for free; a healthy machine passes', async () => {
  const empty = await preflight(preflightInput(replies(wallet(0))));
  assert.equal(empty.ok, false);
  assert.match(empty.problems.join(), /wallet is empty.*nothing was spent/);
  const good = await preflight(preflightInput(replies(wallet(40))));
  assert.deepEqual([good.ok, good.problems, good.warnings], [true, [], []]);
  const low = await preflight(preflightInput(replies(wallet(1))));
  assert.equal(low.ok, true);
  assert.match(low.warnings.join(), /low/);
});

test('preflight: keys, binaries, gsap and disk are each named; a wallet it cannot read warns and never blocks', async () => {
  const bad = await preflight(preflightInput(replies(wallet(40)), {
    secrets: { anthropicApiKey: '', heygenApiKey: '' },
    run: () => ({ status: null, stdout: '', stderr: '', error: 'spawnSync ffmpeg ENOENT' }),
    hyperframesBin: '/nope/hyperframes',
    gsapFile: '/nope/gsap.js',
    freeBytes: () => 1024,
  }));
  const said = bad.problems.join(' ');
  for (const part of [/ANTHROPIC_API_KEY/, /HEYGEN_API_KEY/, /ffmpeg isn't working.*ENOENT/, /ffprobe/, /HyperFrames/, /gsap/, /GB free/]) assert.match(said, part);
  const refused = await preflight(preflightInput(replies(new Response('', { status: 401 }), new Response('', { status: 401 }))));
  assert.match(refused.problems.join(), /Anthropic refused[\s\S]*HeyGen refused/);
  for (const reply of [new Response('{"data":{"billing_type":"subscription"}}'), new Response('', { status: 500 }), new Error('socket hang up')]) {
    const unread = await preflight(preflightInput(replies(reply)));
    assert.equal(unread.ok, true);
    assert.equal(unread.warnings.length, 1);
  }
  assert.deepEqual(heygenWallet({ wallet: { remaining_balance: 3, currency: 'credits' } }), { balance: 3, currency: 'credits' }, 'with or without the data envelope');
});

test('preflight: a network that is down is waited for, then checked', async () => {
  const net = outage(3);
  const out = await preflight(preflightInput(replies(wallet(40)), { network: net }));
  assert.equal(out.ok, true);
  assert.deepEqual(net.events, ['waiting', 'back']);
});

// ── Partial voice ───────────────────────────────────────────────────────────

/** The engine as 42f24a18 saw it: exit 0, some frames dropped. */
const engineDropping = (m: ReturnType<typeof voiceProject>, keep: number[]) => () => {
  const voices = keep.map((frame) => {
    m.write(`assets/voice/0${frame}.wav`);
    return { frame, path: `assets/voice/0${frame}.wav`, duration_s: 2, words: WORDS.slice(0, 3) };
  });
  fs.writeFileSync(path.join(m.project, 'audio_meta.json'), JSON.stringify({ bgm: null, voices, sfx: [] }));
  return { status: 0, stdout: 'frame 2: HeyGen said no', stderr: '' };
};
const failFirstTake = (args: string[]) => (/take-1/.test(args[1]!) ? { status: 1, stdout: '', stderr: '✗ heygen-tts: the take broke' } : null);

test('partial voice: only the missing frames are voiced again, and the one-take reason is flagged', async () => {
  const answers: Parameters<typeof voiceProject>[0] = { take: failFirstTake };
  const m = voiceProject(answers);
  answers.engine = engineDropping(m, [1, 3]);
  const result = await runVoice(m.project, { voiceId: 'v', heygenApiKey: 'k', tempo: 1 }, { run: m.run, retry: quick });
  assert.equal(result.take, 'per_frame');
  assert.match(result.notes.join(' '), /the take broke/);
  assert.match(result.notes.join(' '), /Frames 2 came back without a voice/);
  const again = m.takes.filter((a) => /frame-/.test(a[1]!));
  assert.deepEqual(again.map((a) => a[1]), [path.join('assets', 'voice', 'take', 'frame-02.txt')], 'frames 1 and 3 are not paid for twice');
  assert.deepEqual(missingVoices(m.project, [1, 2, 3].map((frame) => ({ frame, text: 'x' }))), []);
  const meta = JSON.parse(fs.readFileSync(path.join(m.project, 'audio_meta.json'), 'utf8'));
  assert.deepEqual(meta.voices.map((v: { frame: number }) => v.frame), [1, 2, 3]);
  assert.deepEqual(m.paces, ['pace']);
  assert.match(readStepLog(m.project)!, /HeyGen said no/, "the engine's own words are kept though it exited 0");
});

test('partial voice: a frame that stays missing fails clearly, naming it and why, before pace ever runs', async () => {
  const answers: Parameters<typeof voiceProject>[0] = {
    take: (args) => (/take-1/.test(args[1]!) ? { status: 1, stdout: '', stderr: 'the take broke' } : /frame-02/.test(args[1]!) ? { status: 1, stdout: '', stderr: 'text rejected' } : null),
  };
  const m = voiceProject(answers);
  answers.engine = engineDropping(m, [1, 3]);
  await assert.rejects(runVoice(m.project, { voiceId: 'v', heygenApiKey: 'k', tempo: 1 }, { run: m.run, retry: quick }), (e: Error) => {
    assert.match(e.message, /frames 2 have no voice/);
    assert.match(e.message, /text rejected/);
    assert.match(e.message, /the take broke/, 'the one-take reason too, not only on success');
    return true;
  });
  assert.deepEqual(m.paces, [], 'pace never turns a missing voice into a silent frame');
});

test('partial voice: every frame dropped with an exit 0 (the $0 wallet shape) still fails naming the reason', async () => {
  const answers: Parameters<typeof voiceProject>[0] = { take: () => ({ status: 1, stdout: '', stderr: 'HeyGen POST → HTTP 402 out of credits' }) };
  const m = voiceProject(answers);
  await assert.rejects(runVoice(m.project, { voiceId: 'v', heygenApiKey: 'k', tempo: 1 }, { run: m.run, retry: quick }), /refused the take.*HTTP 402/s);
  assert.equal(m.takes.length, 1, 'a refusal is not asked again, frame by frame');
  assert.deepEqual(m.paces, []);
});

test('voice: a passing HeyGen error is retried on the same take, not sent to the fallback; no lock is taken', async () => {
  const m = voiceProject({ take: (_a, n) => (n === 1 ? { status: 1, stdout: '', stderr: 'HeyGen POST → HTTP 429 slow down' } : null) });
  const result = await runVoice(m.project, { voiceId: 'v', heygenApiKey: 'k', tempo: 1 }, { run: m.run, retry: quick });
  assert.equal(result.take, 'one');
  assert.equal(m.takes.length, 2);
});

test('voice: an outage mid-take waits and resumes the take; the fallback never sees it', async () => {
  const net = outage(4);
  let engine = 0;
  const m = voiceProject({
    take: (_a, n) => (n === 1 ? { status: 1, stdout: '', stderr: 'TypeError: fetch failed' } : null),
    engine: () => ((engine += 1), ok()),
  });
  const result = await runVoice(m.project, { voiceId: 'v', heygenApiKey: 'k', tempo: 1 }, { run: m.run, retry: { waitMs: 0, network: net } });
  assert.equal(result.take, 'one');
  assert.equal(engine, 0);
  assert.deepEqual(net.events, ['waiting', 'back']);
});

// ── Outages ─────────────────────────────────────────────────────────────────

test('outages: "Connection error." (the SDK\'s words, which the old list missed) is recognised, a subprocess timeout is not', () => {
  assert.ok(isConnectionLoss(new Error('Connection error.')));
  assert.ok(isTransient(new Error('Connection error.')));
  assert.ok(isConnectionLoss(Object.assign(new Error('x'), { name: 'APIConnectionError' })));
  assert.ok(isConnectionLoss(Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } })));
  assert.ok(!isConnectionLoss(new Error('spawnSync hyperframes ETIMEDOUT')));
  assert.ok(isRefusal(new Error('Your credit balance is too low')));
  assert.ok(!isTransient(Object.assign(new Error('bad request'), { status: 400 })));
});

test('outages: a model call waits out the network as long as it takes, and the wait costs no retry', async () => {
  const net = outage(2000);
  let calls = 0;
  const value = await withRetry(
    async () => {
      if (++calls === 1) throw new Error('Connection error.');
      return 'ok';
    },
    null,
    { waitMs: 0, network: net },
  );
  assert.equal(value, 'ok');
  assert.deepEqual(net.events, ['waiting', 'back']);
});

test('outages: repeated drops with waits between them keep going where plain retries would stop', async () => {
  let calls = 0;
  let down = 0;
  const value = await withRetry(
    async () => {
      if (++calls <= 8) {
        down = 1;
        throw new Error('socket hang up');
      }
      return 'ok';
    },
    null,
    { waitMs: 0, network: { probe: async () => down-- <= 0, sleep: async () => undefined, onWait: () => undefined } },
  );
  assert.equal(value, 'ok');
  assert.equal(calls, 9);
});

test('outages: waits are counted in polls, so a night asleep isn\'t a night waited; only then does it give up', async () => {
  const gave = outage(10);
  assert.deepEqual(await waitForNetwork({ ...gave, maxPolls: 3 }), { online: false, waited: 3 });
  assert.ok(gave.events.includes('gave_up'));
  const realClock = Date.now;
  Date.now = () => realClock() + 24 * 3600 * 1000;
  try {
    assert.equal((await waitForNetwork(outage(2))).online, true);
  } finally {
    Date.now = realClock;
  }
  await assert.rejects(withRetry(async () => { throw new Error('Connection error.'); }, null, { waitMs: 0, network: { ...outage(10), maxPolls: 1 } }), /Connection error/);
});

test('outages: a database query waits too; a bad query fails at once; the rest of the database is untouched', async () => {
  let calls = 0;
  const raw = {
    marker: 7,
    close: () => 'closed',
    query: async (text: string) => {
      calls += 1;
      if (text === 'bad') throw new Error('syntax error at or near');
      if (calls === 1) throw new Error('Connection terminated unexpectedly');
      return { rows: [{ text }] };
    },
  };
  const db = resilientDb(raw, { waitMs: 0, network: outage(1) });
  assert.deepEqual((await db.query('select')).rows, [{ text: 'select' }]);
  assert.equal(db.marker, 7);
  assert.equal(db.close(), 'closed');
  const before = calls;
  await assert.rejects(db.query('bad'), /syntax error/);
  assert.equal(calls, before + 1);
});

test('asleep: a job holds the Mac awake and lets go; elsewhere it does nothing; a missing caffeinate is harmless', () => {
  const started: { cmd: string; args: string[] }[] = [];
  let killed = 0;
  const spawner = ((cmd: string, args: string[]) => {
    started.push({ cmd, args });
    return Object.assign(new EventEmitter(), { kill: () => void (killed += 1) });
  }) as never;
  const release = holdAwake({ platform: 'darwin', spawner, pid: 42 });
  assert.deepEqual(started, [{ cmd: 'caffeinate', args: ['-ims', '-w', '42'] }], 'it also ends with the worker');
  release();
  assert.equal(killed, 1);
  holdAwake({ platform: 'linux', spawner })();
  assert.equal(started.length, 1);
  holdAwake({ platform: 'darwin', spawner: (() => { throw new Error('ENOENT'); }) as never })();
});

// ── No CDN ──────────────────────────────────────────────────────────────────

test('gsap: the shipped copy is the exact file the page asked for, by its integrity hash', () => {
  const hash = createHash('sha384').update(fs.readFileSync(GSAP_FILE)).digest('base64');
  assert.equal(hash, 'sG0Hv1tP1lZCk9KQmrIbY/XNwi+OY84GQqhMscbnsoBFqAz8KNCil1kvfL3Hbbk2');
});

test('gsap: every page points at the project\'s copy before a render, repeatably, and the render waits on no network', async () => {
  const project = tmp();
  const cdn = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';
  fs.mkdirSync(path.join(project, 'compositions', 'frames'), { recursive: true });
  fs.writeFileSync(path.join(project, 'index.html'), `<head><script src="${cdn}" integrity="sha384-x" crossorigin="anonymous"></script></head>`);
  fs.writeFileSync(path.join(project, 'compositions', 'frames', '01-a.html'), `<template><script src="${cdn}"></script></template>`);
  fs.writeFileSync(path.join(project, 'compositions', 'captions.html'), `<script src="${cdn}"></script>`);
  assert.equal(localizeGsap(project), 3);
  assert.equal(localizeGsap(project), 0, 'safe to repeat');
  for (const f of ['index.html', 'compositions/frames/01-a.html', 'compositions/captions.html']) {
    const html = fs.readFileSync(path.join(project, f), 'utf8');
    assert.ok(!html.includes('jsdelivr') && !html.includes('integrity'), f);
    assert.match(html, /src="assets\/kit\/vendor\/gsap\.min\.js"/);
  }
  assert.ok(fs.existsSync(path.join(project, 'assets', 'kit', 'vendor', 'gsap.min.js')));

  const fresh = tmp();
  fs.writeFileSync(path.join(fresh, 'index.html'), `<script src="${cdn}"></script>`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('a render must not touch the network'); }) as typeof fetch;
  try {
    const run: Runner = (_c, args, opts) => {
      if (args[0] === 'render') {
        assert.ok(!fs.readFileSync(path.join(opts.cwd, 'index.html'), 'utf8').includes('jsdelivr'), 'localized before the render starts');
        fs.writeFileSync(path.join(opts.cwd, 'renders', 'video.mp4'), 'mp4');
      }
      return ok();
    };
    await renderVideo(fresh, { run, bin: 'hf' });
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── The crash ("reading 'length'") ──────────────────────────────────────────

test('classification: only a failure of the story itself counts against it', () => {
  for (const env of ['Connection error.', 'The harvest failed: fetch failed', 'Reporting failed: Connection error.']) assert.equal(failureClass(env), 'network', env);
  for (const env of ['Preflight: The HeyGen wallet is empty', 'voice: frames 2 have no voice. x', 'The render failed: hyperframes render exited 255: mix', 'Worker restarted while this job was running.', "Cannot read properties of undefined (reading 'length')", 'ENOSPC: no space left', '529 overloaded_error', 'Your credit balance is too low']) {
    assert.equal(failureClass(env), 'environment', env);
  }
  for (const story of ['The checked script is unusable: no lines', 'The pitch is gone.', 'x']) assert.equal(failureClass(story), 'story', story);
});

test("the crash: the checks' real signatures take sheets, and no-sheets is a clear message, not \"reading 'length'\"", async () => {
  const deps = { create: (async () => { throw new Error('no model here'); }) as never, db: {} as never, mode: 'production' as const, jev: {} as never };
  // run.ts used to hand these `contactSheet` and `stills`; the types now forbid it (see the run below), and this is what's left at run time.
  await assert.rejects(checkFirstViewer(deps, { sheets: [], captions: '', draft: {} as never, facts: {} as never }), /no sheets/);
  assert.deepEqual((await checkDesign(deps, { sheets: [], plan: {} as never, draft: {} as never })).errors, ['no sheets to review']);
});

// ── Whole runs ──────────────────────────────────────────────────────────────

test('step log: appended, never fatal', () => {
  const project = tmp();
  appendStepLog(project, 'one', 'first');
  appendStepLog(project, 'two', { status: 1, stdout: 'out', stderr: 'err', signal: 'SIGTERM' });
  assert.match(readStepLog(project)!, /one\nfirst[\s\S]*two\nstatus 1, SIGTERM[\s\S]*err[\s\S]*out/);
  assert.equal(readStepLog(tmp()), null);
  appendStepLog('/dev/null/not-a-dir', 'x', 'y');
});

const PITCH = { title: 'Fixture', brief: 'b', story_type: 'deal', era: 'race', event_date: '2023-11-17', date_precision: 'day', cast: [{ name: 'Founder', role: 'CEO', kind: 'person', player_id: null }], why_now: null, expected_visuals: [], sources: [] } as unknown as Pitch;
const FACTS = { summary: 's', timeline: [], facts: [{ id: 'F1', text: 't', source_ids: ['S1'], key: true, confidence: 'confirmed' }], sources: [], quotes: [], artifacts: [], cast: [], places: [], verdict: { holds: true, reason: 'r' } } as unknown as FactSheet;
const asset = (id: string, flags: string[] = []) => ({ id, kind: 'person_photo', file: `media/${id}.jpg`, url: `https://example.com/${id}.jpg`, source_page: null, credit: 'Ex', license: null, shows: id, people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown', width: 1080, height: 1920, phash: null, character_image: false, made: false, upscaled: false, flags });
const INVENTORY = { assets: [asset('V1', ['key_moment']), asset('V2'), asset('V3')], usable_count: 20, counts: {}, kill: null, usd: 0 } as unknown as VisualsInventory;
const line = (id: string, text: string) => ({ id, text, on_screen: null, fact_ids: ['F1'], must_show: null });
const DRAFT = { title: 'T', hook: { line_id: 'L1' }, rungs: [{ id: 'R1', purpose: 'setup', lines: [line('L1', 'He wanted the deal.'), line('L2', 'The board met.')] }, { id: 'R2', purpose: 'turn', lines: [line('L3', 'They fired him.')] }], peak_rung_id: 'R2', landing_rung_id: 'R2', close_question: 'Would you?', word_count: 11, central: [] } as unknown as WriterDraft;
const frame = (n: number, ids: string[], a: string, treatment: string) => ({ n, name: `F${n}`, line_ids: ids, treatment, asset_ids: [a], purpose: `p${n}`, music: 'hold', on_screen: null });
const PLAN = { frames: [frame(1, ['L1'], 'V1', 'photo'), frame(2, ['L2'], 'V2', 'map'), frame(3, ['L3'], 'V3', 'photo')], lines_back: [] } as unknown as DirectorPlan;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function freshJob(db: Queryable, title = 'Fixture') {
  const { rows } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.pitches (title, pitch, event_key, status) VALUES ($1, $2::jsonb, $3, 'pooled') RETURNING id`, [title, JSON.stringify(PITCH), `key:${title}`]);
  const pitchId = rows[0]!.id;
  const req = await requestJob(db, { pitchId, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.ok(req.ok);
  return { pitchId, job: (await claimNextJob(db))! };
}
const pitchStatus = async (db: Queryable, id: string) => (await db.query<{ status: string }>('SELECT status FROM reel_ai_drama.pitches WHERE id = $1', [id])).rows[0]!.status;

type Over = { [K in keyof ProductionDeps]?: Partial<ProductionDeps[K]> };
function runDeps(db: Queryable, over: Over & { root?: string } = {}) {
  const root = over.root ?? tmp();
  const calls: string[] = [];
  const seen: Record<string, unknown> = {};
  const note = (n: string) => void calls.push(n);
  const deps: ProductionDeps = {
    db,
    store: localArtifactStore(path.join(root, 'storage')),
    jobsRoot: path.join(root, 'jobs'),
    secrets: { anthropicApiKey: 't', heygenApiKey: 't' },
    voiceId: 'v',
    preflight: over.preflight as ProductionDeps['preflight'],
    jev: () => ({ callCount: 0, ask: async () => { throw new Error('no Jev'); } }) as unknown as DramaJevRunner,
    pool: { nextForProduction: async () => null },
    reporting: { reportStory: async () => (note('reporting'), clone(FACTS)) },
    harvest: {
      harvestVisuals: async (i) => {
        note('harvest');
        fs.mkdirSync(path.join(i.jobDir, 'media'), { recursive: true });
        fs.writeFileSync(path.join(i.jobDir, 'media', 'V1.jpg'), 'jpg');
        return clone(INVENTORY);
      },
      recordUses: async () => undefined,
    },
    writing: {
      writeScript: async () => (note('writer'), clone(DRAFT)),
      editStory: async () => (note('editor'), { tell_back: 't', notes: [] }),
      reviseScript: async (i) => clone(i.draft),
      directReel: async () => (note('director'), clone(PLAN)),
      writePost: async () => ({ caption: 'c', credits: [], question: 'q' }),
      ...over.writing,
    },
    checks: {
      checkFacts: async () => ({ unsupported: [] }),
      checkIntegrity: async () => ({ problems: [] }),
      checkFirstViewer: async (i) => ((seen.viewer = i.sheets), { hookSeconds: 1, understood: true, problems: [] }),
      checkDesign: async (i) => ((seen.design = i.sheets), { problems: [], warnings: [], errors: [], usd: 0 }),
      ...over.checks,
    },
    render: {
      kitGuide: 'KIT',
      prepareWorkspace: async ({ jobsRoot, jobId }) => {
        const jobDir = path.join(jobsRoot, jobId);
        fs.rmSync(jobDir, { recursive: true, force: true });
        const ws = { jobDir, projectDir: path.join(jobDir, 'project'), homeDir: path.join(jobDir, 'home'), tmpDir: path.join(jobDir, 'tmp') };
        for (const d of [ws.projectDir, ws.homeDir, ws.tmpDir]) fs.mkdirSync(d, { recursive: true });
        return ws;
      },
      writeProjectFiles: (dir) => {
        fs.writeFileSync(path.join(dir, 'SCRIPT.md'), '# s');
        fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), '# s');
      },
      runVoice: async () => note('voice'),
      compileReel: async (i) => ({ frames: i.plan.frames.map((f) => ({ n: f.n, id: `0${f.n}-f`, treatment: f.treatment, plain: false })), problems: [] }),
      assembleProject: async () => ({ ok: true, problems: [] }),
      renderVideo: async (dir) => {
        const f = path.join(dir, 'renders', 'video.mp4');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, 'mp4');
        return f;
      },
      contactSheet: async (dir) => {
        const f = path.join(dir, 'renders', 'sheet.png');
        fs.writeFileSync(f, 'png');
        return f;
      },
      ...over.render,
    },
  };
  return { deps, calls, seen, root };
}
async function scratch() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  return db;
}

test('run: a failed preflight ends the job before any step, returns the pitch, and costs it nothing', async () => {
  const db = await scratch();
  const { job, pitchId } = await freshJob(db);
  const { deps, calls } = runDeps(db, { preflight: async () => ({ ok: false, problems: ['The HeyGen wallet is empty.'], warnings: [] }) } as Over);
  const outcome = await runJob(deps, job);
  assert.equal(outcome.status, 'failed');
  assert.deepEqual(calls, [], 'no model, no search, no voice');
  assert.equal(outcome.status === 'failed' && outcome.failureClass, 'environment');
  assert.match((await getJob(db, job.id))!.error!, /Preflight: The HeyGen wallet is empty/);
  assert.equal(await pitchStatus(db, pitchId), 'pooled');
});

test('run: a missing voice id is found before the spend too', async () => {
  const db = await scratch();
  const { job } = await freshJob(db);
  const { deps, calls } = runDeps(db);
  deps.voiceId = null;
  assert.equal((await runJob(deps, job)).status, 'failed');
  assert.deepEqual(calls, []);
});

test('run: environment failures never retire a story, however many; a story failure still does on the second', async () => {
  const db = await scratch();
  const { job, pitchId } = await freshJob(db);
  await finishJob(db, job.id, { status: 'failed', error: 'Connection error.' });
  for (const error of ['voice: frames 2 have no voice. HTTP 402', 'The render failed: hyperframes render exited 255: mix', 'Worker restarted while this job was running.', 'The checked script is unusable: x']) {
    assert.equal(await pitchStatus(db, pitchId), 'pooled', error);
    assert.ok((await requestJob(db, { pitchId, trigger: 'click', settings: DEFAULT_SETTINGS })).ok);
    const next = (await claimNextJob(db))!;
    await finishJob(db, next.id, { status: 'failed', error });
  }
  assert.equal(await pitchStatus(db, pitchId), 'pooled', 'one story failure among four environment ones');
  assert.ok((await requestJob(db, { pitchId, trigger: 'click', settings: DEFAULT_SETTINGS })).ok);
  await finishJob(db, (await claimNextJob(db))!.id, { status: 'failed', error: 'The checked script is unusable: y' });
  assert.equal(await pitchStatus(db, pitchId), 'retired');
});

test('run: a capped job counts against its story, the runaway guard stays', async () => {
  const db = await scratch();
  const { job, pitchId } = await freshJob(db);
  await finishJob(db, job.id, { status: 'failed', error: 'Runaway spend', capped: true });
  assert.ok((await requestJob(db, { pitchId, trigger: 'click', settings: DEFAULT_SETTINGS })).ok);
  await finishJob(db, (await claimNextJob(db))!.id, { status: 'failed', error: 'Connection error.' });
  assert.equal(await pitchStatus(db, pitchId), 'pooled', "this failure wasn't the story's");
  assert.ok((await requestJob(db, { pitchId, trigger: 'click', settings: DEFAULT_SETTINGS })).ok);
  await finishJob(db, (await claimNextJob(db))!.id, { status: 'failed', error: 'Runaway spend', capped: true });
  assert.equal(await pitchStatus(db, pitchId), 'retired');
});

test('run: an outage that outlasts every wait comes back as network, and the requeued job resumes past the director', async () => {
  const db = await scratch();
  const { job, pitchId } = await freshJob(db);
  let dropped = false;
  const first = runDeps(db, {
    render: { runVoice: async () => { dropped = true; throw new Error('voice: take failed: fetch failed'); } },
  });
  const outcome = await runJob(first.deps, job);
  assert.ok(dropped);
  assert.deepEqual(outcome.status === 'failed' && outcome.failureClass, 'network');
  assert.deepEqual(first.calls, ['reporting', 'harvest', 'writer', 'editor', 'director']);
  const kept = (await listArtifacts(db, job.id)).filter((a) => a.kind === 'transcript_log').map((a) => JSON.parse(a.content!));
  assert.match(kept[0].failure.error, /fetch failed/);
  assert.match(kept[0].failure.full, /Error: voice: take failed/, 'with the stack');

  assert.equal(await requeueJob(db, job.id), true);
  assert.equal(await pitchStatus(db, pitchId), 'picked');
  const again = (await claimNextJob(db))!;
  assert.equal(again.id, job.id);
  assert.equal(again.error, null);
  const second = runDeps(db, { root: first.root });
  assert.equal((await runJob(second.deps, again)).status, 'ok');
  assert.deepEqual(second.calls, ['voice'], 'research, story and the director are not paid for again');
  assert.equal(await requeueJob(db, job.id), false, 'only a failed job goes back');
});

test('run: a plan older than the script is stale on resume, so the director runs', async () => {
  const db = await scratch();
  const { job } = await freshJob(db);
  const first = runDeps(db, { checks: { checkFacts: async () => { throw new Error('unused'); } }, writing: { directReel: async () => { throw new Error('Connection error.'); } } });
  assert.equal((await runJob(first.deps, job)).status, 'failed');
  await requeueJob(db, job.id);
  const second = runDeps(db, { root: first.root });
  assert.equal((await runJob(second.deps, (await claimNextJob(db))!)).status, 'ok');
  assert.ok(second.calls.includes('director'), 'no plan was kept: it is written');
  assert.ok(!second.calls.includes('writer'), 'the script stands');
});

test('requeue: not while the pitch has another live job', async () => {
  const db = await scratch();
  const { job, pitchId } = await freshJob(db);
  await finishJob(db, job.id, { status: 'failed', error: 'Connection error.' });
  assert.ok((await requestJob(db, { pitchId, trigger: 'click', settings: DEFAULT_SETTINGS })).ok);
  assert.equal(await requeueJob(db, job.id), false);
});

test('stale jobs: quiet is measured from the last thing a job kept, so a long-running job is left alone', async () => {
  const db = await scratch();
  const { job } = await freshJob(db);
  await db.query(`UPDATE reel_ai_drama.jobs SET started_at = now() - interval '20 hours' WHERE id = $1`, [job.id]);
  await db.query(`INSERT INTO reel_ai_drama.artifacts (job_id, kind, content) VALUES ($1, 'writer_draft', '{}')`, [job.id]);
  assert.equal(await failStaleJobs(db, 'Worker restarted while this job was running.'), 0);
  await db.query(`UPDATE reel_ai_drama.artifacts SET created_at = now() - interval '13 hours' WHERE job_id = $1`, [job.id]);
  assert.equal(await failStaleJobs(db, 'Worker restarted while this job was running.'), 1);
});

test('run: the checks get real sheets from the render, and their failure ships the reel with a flag', async () => {
  const db = await scratch();
  const viewer = [{ frame: 1, file: 'v.jpg', moments: [] }];
  const design = [{ frame: 1, file: 'd.jpg', moments: [] }];
  const { job } = await freshJob(db);
  const good = runDeps(db, { render: { reviewSheets: async () => ({ viewer, design }) } });
  assert.equal((await runJob(good.deps, job)).status, 'ok');
  assert.deepEqual(good.seen.viewer, viewer);
  assert.deepEqual(good.seen.design, design);

  const { job: other } = await freshJob(db, 'Second');
  const broken = runDeps(db, { render: { reviewSheets: async () => { throw new Error('ffmpeg still failed'); } } });
  assert.equal((await runJob(broken.deps, other)).status, 'ok');
  const flags = (await getJob(db, other.id))!.flags.map((f) => f.detail).join('\n');
  assert.match(flags, /first viewer's sheets failed \(ffmpeg still failed\)/);
  assert.match(flags, /Design review failed; shipped without it: ffmpeg still failed/);
});

test("run: a harness bug in a check names where it threw and the reel still ships; a creative pass that throws doesn't lose it", async () => {
  const db = await scratch();
  const { job } = await freshJob(db);
  const { deps } = runDeps(db, {
    checks: { checkFirstViewer: async () => (undefined as unknown as { sheets: unknown[] }).sheets.length as never },
    writing: { creativePass: async () => { throw new Error('solver fell over'); } },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  const flags = (await getJob(db, job.id))!.flags.map((f) => f.detail).join('\n');
  assert.match(flags, /The first viewer failed \(Cannot read properties of undefined \(reading 'sheets'\) \[at /);
  assert.match(flags, /The creative pass failed \(solver fell over\); the reel ships without its touches/);
});

test('delivery: what code changed in the hook ships as a flag', async () => {
  const db = await scratch();
  const { job } = await freshJob(db);
  const hook = { id: 'darkroom', beats: [], charged: { line: 'L1', words: 'deal' }, fallback: 'darkroom', flags: ['No hook qualified; darkroom with one photo.'] } as unknown as HookChoice;
  const { deps } = runDeps(db, { writing: { directReel: async () => ({ ...clone(PLAN), hook }) } });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.ok((await getJob(db, job.id))!.flags.some((f) => f.detail === 'Hook: No hook qualified; darkroom with one photo.'));
});
