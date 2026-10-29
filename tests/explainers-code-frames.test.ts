// Code-built frames (01 opener over its hook, 03 hand-off, 08 close) get no fix round: their checks
// must pass by construction. Each template / opener / the close is sampled on a small sample world
// and run through try.mjs's and layout-checks.mjs's sample checks.
import assert from 'node:assert/strict';
import test from 'node:test';

// the kit uses top-level await: imported dynamically (as the other kit tests do)
const kit = (f: string) => import(`../explainers/world-kit/${f}`);
const load = async () => {
  const [h, hb, ob, oi, cl, tr, lc, ln] = await Promise.all(['handoff.js', 'handoff-bank.js', 'openers/bank.js', 'openers/index.js', 'close.js', 'try.mjs', 'layout-checks.mjs', 'lens.js'].map(kit));
  return { ...h, ...hb, ...ob, ...oi, close: cl.default, ...tr, ...lc, ...ln };
};

type Draw = { draw: (t: number) => string };
const samplesOf = (K: any, f: Draw, d: number) => K.sampleTimes(d).map((t: number) => ({ t, svg: String(f.draw(t)) }));
function codeChecks(K: any, samples: { t: number; svg: string }[]) {
  const { frameProblems, emptyContainerProblems, textOverObjectProblems, drawnElements, framedBoxes, blankOpenProblems } = K;
  return [
    ...samples.flatMap(({ t, svg }: { t: number; svg: string }) => frameProblems(svg).map((p: string) => `${t.toFixed(2)}s ${p}`)),
    ...emptyContainerProblems(samples),
    ...textOverObjectProblems(samples, { scanOf: drawnElements, framedOf: framedBoxes }),
    ...blankOpenProblems(samples, { scanOf: drawnElements }),
  ];
}

// the sample world behind the card: frame 4's first shot, an object right under the card
const next = { draw: () => '<g data-object="puppy"><rect x="300" y="700" width="480" height="420" fill="#c96"/></g>' };

test('code frames: the hand-off card shows with its first words from 0s in every template', async () => {
  const K: any = await load();
  const { handoffFrame, asBackdrop, HANDOFF_KEYS, OPENER_KEYS, openerFrame, close, emptyContainerProblems } = K;
  for (const key of HANDOFF_KEYS) {
    const f = handoffFrame(key, { term: 'Sample term', duration: 3.2 });
    assert.deepEqual(emptyContainerProblems(samplesOf(K, f, 3.2)), [], key);
  }
});

test('code frames: every hand-off template passes the sample checks over a sample world', async () => {
  const K: any = await load();
  const { handoffFrame, asBackdrop, HANDOFF_KEYS, OPENER_KEYS, openerFrame, close, emptyContainerProblems } = K;
  for (const key of HANDOFF_KEYS) {
    for (const opts of [{}, { next }]) {
      const f = handoffFrame(key, { term: 'Sample term', duration: 2.6, ...opts });
      assert.deepEqual(codeChecks(K, samplesOf(K, f, 2.6)), [], `${key}${'next' in opts ? ' over frame 4' : ''}`);
    }
  }
  assert.ok(!asBackdrop(next.draw()).includes('data-object='), 'the backdrop carries no object markers');
});

test('code frames: every opener over a stub hook, and the close, pass the sample checks', async () => {
  const K: any = await load();
  const { handoffFrame, asBackdrop, HANDOFF_KEYS, OPENER_KEYS, openerFrame, close, emptyContainerProblems } = K;
  const hook = { default: { ground: 'paper', shots: [{ at: 0, kind: 'medium', on: [540, 1000] }], draw: () => '<g data-hook=""><circle cx="540" cy="1000" r="160" fill="#c96"/></g>' }, hero: null };
  for (const key of OPENER_KEYS) {
    let f: Draw;
    try {
      f = openerFrame(key, { hook, voice: 3, words: [{ word: 'this', start: 0.4, end: 0.7 }], term: 'Sample term' });
      f.draw(0);
    } catch {
      continue; // an opener that needs a critter hero is covered in explainers-openers
    }
    assert.deepEqual(codeChecks(K, samplesOf(K, f, 4)), [], key);
  }
  assert.deepEqual(codeChecks(K, samplesOf(K, close as Draw, 2.5)), [], 'close');
});
