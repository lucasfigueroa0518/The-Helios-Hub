// Sound on the picture (Lucas 2026-11-17: "the whoosh that is supposed to align with the orange trim
// ... does not align ... it can never be wrong"). Each event moves to the motion it belongs to, and
// each sound starts so that its measured hit (a whoosh's peak, anything else's onset) lands on it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { mixArgs, resolveCues } from '../explainers/world-kit/sound.mjs';
import { FPS, features, offBeat, soundShape, syncTime } from '../explainers/world-kit/sync.mjs';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** A curve (changed pixels per sample) of `secs` seconds with the given pieces added. */
function curve(secs: number, ...parts: ((t: number) => number)[]) {
  return Array.from({ length: Math.round(secs * FPS) + 1 }, (_, i) => Math.round(parts.reduce((s, p) => s + p(i / FPS), 0)));
}
/** An eased move from a to b: speed rises and falls, fastest in the middle. */
const move = (a: number, b: number, h: number) => (t: number) => (t < a || t > b ? 0 : h * Math.sin((Math.PI * (t - a)) / (b - a)));
/** Something appearing at once. */
const appear = (at: number, size: number) => (t: number) => (Math.abs(t - at) < 0.5 / FPS ? size : 0);

test('a whoosh written at the start of a move peaks at its fastest moment', () => {
  // the Context Window trim: written at 5.95, the glint runs 5.95 – 7.25
  const c = curve(10, move(5.95, 7.25, 240));
  const s = syncTime(c, { t: 5.95, kind: 'whoosh' });
  assert.ok(Math.abs(s.t - 6.6) < 0.07, `whoosh at ${s.t}`);
});

test('the nearest move wins, and an instant change is not a move', () => {
  // the Context Window letter: the move it rides (1.43 – 2.03), the next one, then a big cut-in
  const c = curve(4, move(1.43, 2.03, 265), move(2.05, 2.35, 310), appear(2.43, 17000));
  const f = features(c);
  assert.ok(f.spikes.some((s) => Math.abs(s.t - 2.433) < 0.04), JSON.stringify(f.spikes));
  const s = syncTime(c, { t: 1.364, kind: 'whoosh' });
  assert.ok(Math.abs(s.t - 1.73) < 0.07, `whoosh at ${s.t}`);
  assert.ok(Math.abs(syncTime(c, { t: 2.42, kind: 'pop' }).t - 2.433) < 0.04, 'a pop sits on the cut-in');
});

test('impacts sit where a move stops, clicks where it starts', () => {
  const c = curve(6, move(2, 3, 200));
  assert.ok(Math.abs(syncTime(c, { t: 3.2, kind: 'impact' }).t - 3) < 0.1);
  assert.ok(Math.abs(syncTime(c, { t: 1.8, kind: 'click' }).t - 2) < 0.1);
});

test('an event with no motion near it keeps its time, and a sting never moves', () => {
  const c = curve(8, move(1, 1.5, 200));
  assert.deepEqual(syncTime(c, { t: 5, kind: 'whoosh' }), { t: 5, from: 5, moved: false });
  assert.equal(syncTime(c, { t: 1.2, kind: 'sting' }).moved, false);
  assert.equal(syncTime([], { t: 1.2, kind: 'impact' }).moved, false);
});

const CAT = [
  { id: 'w', file: 'w.wav', kind: 'whoosh', tags: ['whoosh'], duration: 1, peakDb: -6 },
  { id: 'p', file: 'p.wav', kind: 'pop', tags: ['pop'], duration: 0.4, peakDb: -6 },
];

test("each sound starts so that its measured hit lands on the cue, not a guessed 45%", () => {
  const shapes: Record<string, { onset: number; peak: number }> = { w: { onset: 0.1, peak: 0.8 }, p: { onset: 0.05, peak: 0.07 } };
  const { resolved } = resolveCues(CAT, [{ t: 4, kind: 'whoosh' }, { t: 6, kind: 'pop' }], { shapeOf: (s: { id: string }) => shapes[s.id] }) as { resolved: { kind: string; start: number; hitAt: number }[] };
  assert.equal(resolved.find((r) => r.kind === 'whoosh')!.start, 3.2);
  assert.equal(resolved.find((r) => r.kind === 'pop')!.start, 5.95);
  // a whoosh whose lead-in is longer than the time before it: the head is cut, the peak still lands
  const early = resolveCues(CAT, [{ t: 0.3, kind: 'whoosh' }], { shapeOf: (s: { id: string }) => shapes[s.id] }) as { resolved: { start: number; head: number }[] };
  assert.equal(early.resolved[0].start, 0);
  assert.equal(early.resolved[0].head, 0.5);
  assert.match(mixArgs(early.resolved, 2, 'o.wav', '/lib').join(' '), /atrim=start=0\.5,asetpts/);
});

test('a measured whoosh peaks where it is placed in the mix', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  const file = path.join(dir, 'w.wav');
  // 1 s of noise that swells to a peak at 0.7 s and dies away
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=1:a=0.5', '-af', "volume='if(lt(t,0.7),t/0.7,max(0,1-(t-0.7)/0.3))':eval=frame", file]);
  const shape = soundShape(file)!;
  assert.ok(Math.abs(shape.peak - 0.7) < 0.06, `peak ${shape.peak}`);
  const { resolved } = resolveCues([{ ...CAT[0], file: 'w.wav' }], [{ t: 2, kind: 'whoosh' }], { shapeOf: () => shape }) as { resolved: unknown[] };
  const out = path.join(dir, 'mix.wav');
  spawnSync('ffmpeg', mixArgs(resolved as never, 4, out, dir));
  assert.deepEqual(offBeat(out, resolved as never), []);
});
