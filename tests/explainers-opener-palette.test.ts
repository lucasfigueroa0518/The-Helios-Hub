import assert from 'node:assert/strict';
import test from 'node:test';

import { BANK_BREAKS, BREAK, SWISH, applyPalette, drawPalette, familyOf, openingProblems, palettePools } from '../explainers/world-kit/openers/palette.mjs';
import { loadLibrary } from '../explainers/design/sfx/library.mjs';

type S = { file: string; group?: string; kind?: string };
const catalog: S[] = loadLibrary();
const bankOnly: S[] = loadLibrary(undefined, { dropins: false });

test('palette: the break is the one impact, the cut is never an impact, no family twice', () => {
  for (const cat of [catalog, bankOnly]) {
    for (let i = 0; i < 40; i++) {
      const p = drawPalette(cat, `job-${i}`);
      assert.ok(p.break && p.swish && p.cut, JSON.stringify(p));
      assert.notEqual(p.cut.kind, 'impact', `cut ${p.cut.file}`);
      assert.notEqual(p.swish.kind, 'impact', `swish ${p.swish.file}`);
      const fams = [p.break, p.swish, p.cut].map(familyOf);
      assert.equal(new Set(fams).size, 3, fams.join(', '));
    }
  }
});

test('palette: seeded (a job keeps its palette), and different jobs get different breaks', () => {
  assert.deepEqual(drawPalette(catalog, 'abc'), drawPalette(catalog, 'abc'));
  const breaks = new Set(Array.from({ length: 30 }, (_, i) => drawPalette(catalog, `j${i}`).break.file));
  assert.ok(breaks.size >= 5, `only ${breaks.size} distinct breaks over 30 jobs`);
});

test('palette: without drop-ins (the VM) it falls back to the bank, and the two old bass hits are never both drawn', () => {
  const pools = palettePools(bankOnly);
  assert.ok(pools.breaks.every((s: S) => BANK_BREAKS.includes(s.file)));
  for (let i = 0; i < 40; i++) {
    const p = drawPalette(bankOnly, `vm-${i}`);
    const files = [p.break, p.swish, p.cut].map((s: S) => s.file);
    assert.ok(files.filter((f) => /impact-bass/.test(f)).length <= 1, files.join(', '));
  }
});

test('applyPalette resolves the placeholders; openingProblems flags two heavy hits and a repeated family', () => {
  const p = drawPalette(catalog, 'x');
  const clips = applyPalette([{ src: BREAK, at: 1 }, { src: SWISH, at: 0.5 }, { src: 'pixabay/pop.mp3', at: 0 }], p);
  assert.deepEqual(clips.map((c: { src: string }) => c.src), [p.break.file, p.swish.file, 'pixabay/pop.mp3']);
  assert.deepEqual(openingProblems([p.break.file, p.swish.file, p.cut.file], catalog), []);
  const twice = openingProblems(['pixabay/impact-bass-1.mp3', 'pixabay/impact-bass-2.mp3'], catalog);
  assert.ok(twice.some((x: string) => /heavy hits/.test(x)), twice.join('; '));
  assert.ok(twice.some((x: string) => /family/.test(x)), twice.join('; '));
});
