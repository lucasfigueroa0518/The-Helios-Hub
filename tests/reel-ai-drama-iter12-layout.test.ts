import assert from 'node:assert/strict';
import test from 'node:test';

import { boxInFrame, phraseLines, pieceKind, poseAt, solveTimeline, splitWrapped } from '../explainers/reel-ai-drama/kit/stage-layout.js';

type Any = any;
const person = { id: 'P1', kind: 'person_photo', width: 1000, height: 1400, people: ['Person 1'], flags: ['cutout', 'transparent'], regions: { faces: [{ x: 0.35, y: 0.12, w: 0.3, h: 0.22, trusted: true, score: 0.95, name: 'Person 1' }], visible: { x: 0.1, y: 0.02, w: 0.8, h: 0.98 } } };
const logo = (id: string, w: number, h: number) => ({ id, kind: 'logo', width: w, height: h, people: [], flags: ['logo'], regions: { visible: { x: 0.02, y: 0.05, w: 0.96, h: 0.9 }, faces: [] } });

test('a push never carries a logo off the frame edge', () => {
  for (const zoom of [1.1, 1.3]) {
    const out: Any = solveTimeline({ pieces: [{ id: 'a', media: logo('L1', 960, 205), at: 0 }, { id: 'b', media: logo('L2', 960, 291), side: 'left', at: 0 }, { id: 'c', media: person, role: 'lead', side: 'right', at: 0 }], arrangement: 'face_off', style: 'cutouts', camera: { move: 'push', stops: [{ at: 2, aim: 'face:Person 1', zoom }] }, duration: 6 } as never);
    const placed = new Map(out.moments.at(-1).pieces.map((p: Any) => [p.id, p]));
    for (let t = 0; t <= 6; t += 0.1) {
      const pose = poseAt(out.camera.keys, t);
      for (const p of out.prepared.filter((q: Any) => q.kind === 'logo')) {
        const pl: Any = placed.get(p.id);
        const b = boxInFrame(pl.placement ?? pl, p.vis);
        const x0 = pose.s * b.x + pose.tx, x1 = pose.s * (b.x + b.w) + pose.tx;
        assert.ok(x0 >= 15 && x1 <= 1065, `zoom ${zoom}, ${p.id} at ${t.toFixed(1)}s spans ${Math.round(x0)}–${Math.round(x1)}`);
      }
    }
  }
});

test('a phrase measured over two lines is shared out by line, so a mark finds the right line', () => {
  const text = 'Search engine slap fight: Microsoft denies cheating';
  const media = { width: 1000, height: 1000, boxes: [{ text, x: 100, y: 100, w: 800, h: 60 }, { text, x: 100, y: 170, w: 400, h: 60 }] };
  assert.deepEqual(splitWrapped([{ text: 'one', box: { x: 0, y: 0, w: 1, h: 1 } }]).map((w: Any) => w.text), ['one']);
  const lines = phraseLines(media, 'denies cheating');
  assert.equal(lines.length, 1);
  assert.ok(Math.abs(lines[0].y - 0.17) < 1e-6, 'on the second line');
  const whole = phraseLines(media, 'Microsoft denies cheating');
  assert.equal(whole.length, 2, 'Microsoft ends line one; the rest is line two');
});

test('a screen capture filed as a photo is laid out as a page of words', () => {
  assert.equal(pieceKind({ kind: 'event_photo', people: [], flags: ['text_heavy', 'faces:0'] }), 'card');
  assert.equal(pieceKind({ kind: 'event_photo', people: [], flags: [] }), 'print');
  assert.equal(pieceKind({ kind: 'event_photo', people: ['Ana Ruiz'], flags: ['text_heavy', 'faces:0'] }), 'print');
});
