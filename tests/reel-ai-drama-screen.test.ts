import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { screenProblems } from '../explainers/reel-ai-drama/kit/screen.mjs';
import { voiceCuts } from '../explainers/reel-ai-drama/kit/assemble.mjs';

const moment = (t: number, o: Record<string, unknown> = {}) => ({ t, cover: 0.5, imgs: [], texts: [], blocks: [], ...o });

test('screen: an empty stretch of 0.4s or more is empty_frame; a shorter one is not, unless the frame opens on it', () => {
  const long = [0, 0.2, 0.4, 0.6, 0.8].map((t) => moment(t, { cover: t < 0.8 ? 0.02 : 0.5 }));
  assert.ok(screenProblems(long, { duration: 1 }).some((p: string) => p.startsWith('[empty_frame]')));
  const short = [0, 0.2, 0.4, 0.6].map((t) => moment(t, { cover: t === 0.2 ? 0.02 : 0.5 }));
  assert.ok(!screenProblems(short, { duration: 1 }).some((p: string) => p.startsWith('[empty_frame]')));
  const opens = [0, 0.2, 0.4].map((t) => moment(t, { cover: t < 0.2 ? 0.02 : 0.5 }));
  assert.match(screenProblems(opens, { duration: 1 }).join('\n'), /\[empty_frame\] the frame opens on an empty screen/);
});

test('screen: a visible image with no picture is image_unloaded', () => {
  const m = [moment(0, { imgs: [{ label: 'V4.jpg', loaded: false, inside: 1, bleed: false, rect: [0, 0, 10, 10] }] })];
  assert.match(screenProblems(m, { duration: 1 }).join('\n'), /\[image_unloaded\] "V4.jpg"/);
});

test('screen: parked half off the edge is off_frame; parked at the start then moving in is early_visible; full-bleed is fine', () => {
  const parked = [0, 0.2, 0.4, 0.6].map((t) => moment(t, { imgs: [{ label: 'logo.png', loaded: true, inside: 0.3, bleed: false, rect: [900, 100, 1300, 400] }] }));
  assert.match(screenProblems(parked, { duration: 1 }).join('\n'), /\[off_frame\] "logo.png"/);
  const entering = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map((t) => moment(t, {
    imgs: [{ label: 'cut.png', loaded: true, inside: t < 0.8 ? 0.2 : 1, bleed: false, rect: t < 0.8 ? [-400, 0, 100, 900] : [0, 0, 500, 900] }],
  }));
  assert.match(screenProblems(entering, { duration: 1.2 }).join('\n'), /\[early_visible\] "cut.png"/);
  const bleed = parked.map((m) => ({ ...m, imgs: m.imgs.map((i: object) => ({ ...i, bleed: true })) }));
  assert.equal(screenProblems(bleed, { duration: 1 }).length, 0);
});

test('screen: low contrast and unplated text on a busy picture are reported; a plated one is not', () => {
  const m = [moment(0, { texts: [{ label: 'TensorFlow', contrast: 1.1, busy: false, plated: false }, { label: 'As recalled', contrast: 4, busy: true, plated: false }, { label: 'Plated', contrast: 9, busy: true, plated: true }] })];
  const out = screenProblems(m, { duration: 1 }).join('\n');
  assert.match(out, /\[low_contrast\] "TensorFlow"/);
  assert.match(out, /\[text_over_text\] "As recalled"/);
  assert.doesNotMatch(out, /Plated/);
});

test('assemble: a frame shorter than its voice is a voice_cut; the close is exempt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-cut-'));
  fs.writeFileSync(path.join(dir, 'audio_meta.json'), JSON.stringify({ voices: [{ frame: 1, duration_s: 4.24 }, { frame: 2, duration_s: 3.2 }] }));
  fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), [
    '## Frame 1 — Open', '- src: compositions/frames/01-open.html', '- treatment: photo', '- duration: 4.05s', '',
    '## Frame 2 — Next', '- src: compositions/frames/02-next.html', '- treatment: photo', '- duration: 4.05s', '',
  ].join('\n'));
  const cuts = voiceCuts(dir);
  assert.equal(cuts.length, 1);
  assert.match(cuts[0], /\[voice_cut\] frame 1/);
});

test('photo crop: a face lands on the subject line; no face means no override', async () => {
  const { faceFocus, FACE_LINE } = await import('../explainers/reel-ai-drama/kit/components/treatments.js');
  const [w, h] = [2000, 1500];
  const face = { x: 0.4, y: 0.05, w: 0.2, h: 0.2 };
  const [, fy] = faceFocus(face, w, h)!;
  const s = Math.max(1080 / w, 1920 / h);
  const faceOnScreen = 960 - (fy - (face.y + face.h / 2)) * h * s;
  assert.ok(Math.abs(faceOnScreen / 1920 - FACE_LINE) < 0.01);
  assert.equal(faceFocus(null, w, h), null);
});

test('live calls retry a dropped connection or an overloaded API, never a real error', async () => {
  const { withRetry, isTransient } = await import('@/lib/reel-ai-drama/retry');
  let n = 0;
  const flaky = async () => { if (n++ < 2) throw new TypeError('terminated'); return 'ok'; };
  assert.equal(await withRetry(flaky, null, { waitMs: 1 }), 'ok');
  assert.equal(n, 3);
  assert.ok(isTransient({ status: 529 }) && !isTransient({ status: 400, message: 'invalid_request' }));
  await assert.rejects(withRetry(async () => { throw Object.assign(new Error('bad'), { status: 400 }); }, null, { waitMs: 1 }), /bad/);
});

test('screen: a mark with no target, or over nothing for 0.4s, is mark_on_nothing; a mark on its word is not', () => {
  const ring = (content: boolean, target = true) => ({ label: 'ring on V4.jpg', target, content });
  const blank = [0, 0.2, 0.4].map((t) => moment(t, { marks: [ring(false)] }));
  assert.match(screenProblems(blank, { duration: 1 }).join('\n'), /\[mark_on_nothing\] "ring on V4.jpg" marks nothing visible/);
  const landing = [moment(0, { marks: [ring(false)] }), moment(0.2, { marks: [ring(true)] }), moment(0.4, { marks: [ring(true)] })];
  assert.deepEqual(screenProblems(landing, { duration: 1 }), [], 'a blank moment as the target arrives is not reported');
  const loose = [moment(0, { marks: [{ label: 'hand-drawn orange stroke 1', target: false, content: false }] })];
  assert.match(screenProblems(loose, { duration: 1 }).join('\n'), /\[mark_on_nothing\] "hand-drawn orange stroke 1" has no target element/);
  const fine = [0, 0.2, 0.4, 0.6].map((t) => moment(t, { marks: [{ label: 'underline on $6 million', target: true, content: true }] }));
  assert.deepEqual(screenProblems(fine, { duration: 1 }), []);
});
