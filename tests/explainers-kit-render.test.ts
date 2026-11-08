/**
 * Explainers visual system 4.0 (hx-4), the RENDER part: the wider palette and its ramps, the
 * grounds (paper studio sweep, the premium stage, white; night and forest as aliases), the one
 * light, the critter ruler, smooth motion, and the soft-3D primitives (same signatures and return
 * shapes, no wobble, grain, stipple or grid). Offline: no model, no browser.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

import * as HX from '../explainers/world-kit/core.js';
import { darkWindows, frameHtml, GROUND_NAMES } from '../explainers/world-kit/mount.mjs';

// draw.js imports perfect-freehand from the CDN; try.mjs stubs it for Node.
const load = async () => {
  await import('../explainers/world-kit/try.mjs');
  const D = await import('../explainers/world-kit/draw.js');
  const K = await import('../explainers/world-kit/props/kit.js');
  return { D, K };
};

const NO_HAND = /feTurbulence|feDisplacementMap|wobble|grain|stipple/;

test('hx-4: the version, and every new color with its ramp as the spec gives it', () => {
  assert.equal(HX.VERSION, 'hx-4');
  const want: Record<string, string> = {
    yellow: '#F1C45E', 'yellow-lit': '#FFDFB2', 'yellow-shade': '#CFAE45', 'yellow-dark': '#99862B',
    blue: '#5A98CB', 'blue-lit': '#82AFDF', 'blue-shade': '#3E81AF', 'blue-dark': '#17597B',
    teal: '#57AFAF', 'teal-lit': '#80C7BF', 'teal-shade': '#3D959B', 'teal-dark': '#1D6972',
    lilac: '#A482BE', 'lilac-lit': '#BF9BCE', 'lilac-shade': '#886BA6', 'lilac-dark': '#5B4778',
    'stage-top': '#161616', 'stage-bottom': '#0B0B0B', 'stage-orange': '#FF6A2A', 'stage-red': '#E8413B',
    'sun-top': '#FDC60F', 'sun-mid': '#F48C3F', 'sun-bottom': '#EA3C3A',
  };
  for (const [k, v] of Object.entries(want)) assert.equal((HX.TOKENS as Record<string, string>)[k], v, k);
  for (const k of ['green-lit', 'green-shade', 'green-dark']) assert.match((HX.TOKENS as Record<string, string>)[k], /^#[0-9A-F]{6}$/, k);
  // every old key is still there
  for (const k of ['paper', 'paper-lit', 'paper-shade', 'paper-dark', 'canvas', 'ink', 'ink-lit', 'orange', 'orange-lit', 'orange-shade', 'orange-dark', 'orange-text', 'green', 'night', 'status-error']) assert.ok((HX.TOKENS as Record<string, string>)[k], k);
  // a ramp for every palette color, lightest to darkest
  const lum = (h: string) => [1, 3, 5].reduce((a, i, j) => a + parseInt(h.slice(i, i + 2), 16) * [0.2126, 0.7152, 0.0722][j], 0);
  for (const name of HX.PALETTE) {
    const r = HX.ramp(name);
    assert.ok(lum(r.lit) > lum(r.base) && lum(r.base) > lum(r.shade) && lum(r.shade) > lum(r.dark), `${name} ramp runs light to dark`);
  }
  assert.throws(() => HX.ramp('pink'), /no ramp "pink"/);
  assert.equal(HX.mixHex('#000000', '#FFFFFF', 0), '#000000');
  assert.equal(HX.mixHex('#000000', '#FFFFFF', 1), '#FFFFFF');
});

test('hx-4: the grounds are paper, stage and white; night and forest resolve to the stage', () => {
  assert.deepEqual(Object.keys(HX.GROUNDS), ['paper', 'stage', 'white']);
  assert.equal(HX.GROUNDS.stage.dark, true);
  assert.equal(HX.GROUNDS.paper.dark, false);
  assert.equal(HX.GROUNDS.white.fill, '#FFFFFF');
  for (const old of ['night', 'forest']) assert.deepEqual(HX.groundOf(old), { name: 'stage', ...HX.GROUNDS.stage });
  assert.equal(HX.groundOf('paper').name, 'paper');
  assert.throws(() => HX.groundOf('mud'), /ground must be paper, stage, white/);
  // mount: the names, dark windows for the stage (and its old names), an alias still mounts
  assert.deepEqual(GROUND_NAMES, ['paper', 'stage', 'white']);
  const f = (d: number, ground: string) => ({ duration: d, fields: { ground } });
  assert.deepEqual(darkWindows([f(4, 'paper'), f(5, 'stage'), f(5, 'night'), f(3, 'white')] as never), [[4, 14]]);
  assert.match(frameHtml('02-scene', 6, 'stage'), /underlay\('uf02_scene-', 'stage'\)/);
  assert.doesNotThrow(() => frameHtml('02-scene', 6, 'forest'));
  assert.throws(() => frameHtml('02-scene', 6, 'mud'), /must be paper, stage, white/);
});

test('hx-4: one light from the top right, the critter ruler, and smooth motion', () => {
  assert.deepEqual(HX.LIGHT.key, [0.62, -0.78]);
  assert.ok(HX.LIGHT.ambient > 0 && HX.LIGHT.ambient < 1 && HX.LIGHT.bounce > 0 && HX.LIGHT.bounce < 1);
  assert.equal(HX.CRITTER_CM, 72);
  assert.equal(HX.CRITTER_PX, 142, "the critter's drawn height at s = 1 (body top y −142 to the feet)");
  assert.ok(Math.abs(HX.PX_PER_CM - 142 / 72) < 1e-12);
  for (const t of [0, 0.033, 0.066, 1.2345]) assert.equal(HX.onTwos(t), t, 'no twos');
  assert.equal(HX.boilSeed(0.05), HX.boilSeed(0.65));
  assert.equal(typeof HX.FPS_BOIL, 'number');
});

test('draw: scope takes the aliases; defs are the soft filters, with no wobble, grain or stipple', async () => {
  const { D } = await load();
  D.scope('r-', 'night');
  assert.equal(D.groundName(), 'stage');
  assert.equal(D.isDark(), true);
  assert.equal(D.line(), HX.TOKENS['paper-lit']);
  D.scope('r-', 'paper');
  assert.equal(D.isDark(), false);
  assert.throws(() => D.scope('r-', 'mud'), /ground must be/);
  const defs = D.defs({ wobble: 3, wobbleSeed: 4 });
  for (const id of ['soft-shadow', 'ao', 'glow', 'blur-bg', 'blur-fg']) assert.match(defs, new RegExp(`id="r-${id}"`), id);
  assert.doesNotMatch(defs, NO_HAND);
  assert.equal(D.grid({ cell: 72 }), '');
  for (const g of ['paper', 'stage', 'white', 'night']) {
    const svg = D.ground(g);
    assert.doesNotMatch(svg, NO_HAND, g);
    assert.ok(!/NaN|undefined/.test(svg), g);
  }
  assert.match(D.ground('paper'), new RegExp(HX.TOKENS['paper-sweep']));
  assert.match(D.ground('stage'), new RegExp(HX.TOKENS['stage-top']));
  assert.match(D.ground('stage'), new RegExp(HX.TOKENS['stage-orange']));
  // the marks keep no wobble either
  assert.equal(D.handwrite('hello', 100, 500, 60, 0), '<g data-k="text" data-text="hello"></g>');
  assert.doesNotMatch(D.stippleShade('rect', { x: 0, y: 0, width: 10, height: 10 }, HX.TOKENS.ink, {}), /filter/);
});

test('draw: TONES for every palette color, named and indexed, lit from the right', async () => {
  const { D } = await load();
  const lum = (h: string) => [1, 3, 5].reduce((a, i, j) => a + parseInt(h.slice(i, i + 2), 16) * [0.2126, 0.7152, 0.0722][j], 0);
  for (const name of ['paper', 'ink', 'orange', 'green', 'yellow', 'blue', 'teal', 'lilac']) {
    const t = (D.TONES as Record<string, any>)[name];
    for (const k of ['top', 'left', 'right', 'lit', 'base', 'shade', 'dark']) assert.match(t[k], /^#[0-9A-F]{6}$/i, `${name}.${k}`);
    assert.deepEqual([t[0], t[1], t[2]], [t.top, t.left, t.right], `${name} keeps its old indexes`);
    assert.ok(lum(t.right) > lum(t.left), `${name}: the face toward the light is lighter`);
  }
  // an old [top, mid, dark] array still works, its lighter side going on the lit face
  const old = D.tonesOf(['#FEF9F3', '#DCD5C9', '#CAC1B3']);
  assert.equal(old.right, '#DCD5C9');
  assert.equal(old.left, '#CAC1B3');
  assert.equal(D.tonesOf('teal'), D.TONES.teal);
  assert.equal(D.tonesOf(HX.TOKENS.blue).base, HX.TOKENS.blue);
});

test('draw: isoBox, isoDisc, shadow and gloss are soft volumes with the same signatures and shapes', async () => {
  const { D } = await load();
  D.scope('r-', 'paper');
  const P = HX.iso(500, 900, 1);
  const box = D.isoBox(P, 0, 0, 0, 100, 80, 60, D.TONES.orange, { radius: 8, gloss: true });
  assert.deepEqual(Object.keys(box).sort(), ['left', 'right', 'svg', 'top']);
  for (const face of [box.top, box.left, box.right]) {
    assert.equal(face.length, 4);
    for (const p of face) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
  }
  assert.deepEqual(box.top[0], P(0, 0, 60));
  assert.ok(!/NaN|undefined/.test(box.svg));
  assert.doesNotMatch(box.svg, NO_HAND);
  assert.match(box.svg, /linearGradient/, 'faces are gradients');
  assert.match(box.svg, /clip-path/, 'rounded silhouette');
  assert.doesNotMatch(box.svg, new RegExp(`stroke="${HX.TOKENS.ink}"`), 'no ink outline by default');
  assert.equal(D.isoBox(P, 0, 0, 0, 100, 80, 60, D.TONES.orange, { radius: 8, gloss: true }).svg, box.svg, 'deterministic');
  // the old option names are accepted; an outline is opt-in
  assert.ok(D.isoBox(P, 0, 0, 0, 50, 50, 50, D.TONES.paper, { sw: 3, grain: false } as never).svg.length > 0);
  assert.match(D.isoBox(P, 0, 0, 0, 50, 50, 50, D.TONES.paper, { outline: true }).svg, new RegExp(`stroke="${HX.TOKENS.ink}"`));
  // flat and on the stage
  assert.ok(!/NaN/.test(D.isoBox(P, 0, 0, 0, 100, 80, 0).svg));
  D.scope('r-', 'stage');
  assert.match(D.isoBox(P, 0, 0, 0, 100, 80, 60, D.TONES.paper).svg, new RegExp(HX.TOKENS['stage-orange']), 'a warm rim on the stage');
  D.scope('r-', 'paper');
  const disc = D.isoDisc(400, 800, 60, 30, D.TONES.teal, { rings: 2, gloss: true });
  assert.equal(typeof disc, 'string');
  assert.ok(!/NaN|undefined/.test(disc));
  assert.doesNotMatch(disc, NO_HAND);
  const sh = D.shadow(100, 100, 40, 12);
  assert.match(sh, /radialGradient/);
  assert.match(sh, new RegExp(HX.TOKENS['shadow-warm']));
  assert.match(D.gloss('M 0 0 L 10 0 L 10 10 Z', { strength: 0.5 }), /<path d="M 0 0 L 10 0 L 10 10 Z" fill="url\(#r-l/);
  const blob = D.softShape('M 0 0 L 40 0 L 40 40 Z', HX.TOKENS.lilac);
  assert.doesNotMatch(blob, /stroke="#1F1915"/);
  assert.match(blob, /clipPath/);
});

test('props: the kit primitives keep their signatures; soften() takes the ink off a drawing', async () => {
  const { D, K } = await load();
  D.scope('r-', 'paper');
  assert.equal(typeof K.box(0, 0, 0, 10, 10, 10), 'string');
  assert.equal(typeof K.cbox(0, 0, 0, 10, 10, 10, K.TONES.ink), 'string');
  assert.equal(typeof K.cyl(0, 0, 0, 10, 20), 'string');
  assert.doesNotMatch(K.shape('M 0 0 L 10 0 L 10 10 Z', HX.TOKENS.orange), /stroke="#1F1915"/);
  assert.doesNotMatch(K.mark('M 0 0 L 10 0'), /stroke="#1F1915"/);
  const ink = HX.TOKENS.ink;
  const out = K.soften(`<rect x="0" y="0" width="10" height="10" fill="${HX.TOKENS['paper-lit']}" stroke="${ink}" stroke-width="4"></rect><path d="M 0 0 L 9 9" fill="none" stroke="${ink}" stroke-width="3"></path><clipPath id="c"><rect x="0" y="0" width="5" height="5" fill="${ink}"></rect></clipPath><g data-k="text"><path d="M 1 1 L 2 2" fill="none" stroke="${ink}"></path></g>`);
  assert.doesNotMatch(out.split('<clipPath')[0], new RegExp(`stroke="${ink}"`), 'outlines and detail lines lose the ink');
  assert.match(out, /fill="url\(#r-sf/, 'a flat fill becomes a soft gradient');
  assert.match(out, new RegExp(`<clipPath id="c"><rect x="0" y="0" width="5" height="5" fill="${ink}">`), 'clip paths untouched');
  assert.match(out, new RegExp(`<g data-k="text"><path d="M 1 1 L 2 2" fill="none" stroke="${ink}">`), 'handwriting untouched');
  assert.equal(K.soften(out), K.soften(out), 'pure');
});

test('props: every library prop and the bank draw soft (no ink outline on a filled shape, no wobble)', async () => {
  const { D } = await load();
  const { PROPS, prop, propNames } = await import('../explainers/world-kit/props.js');
  for (const ground of ['paper', 'stage']) {
    D.scope('r-', ground);
    for (const name of propNames()) {
      for (const state of (PROPS as Record<string, { states: string[] }>)[name].states) {
        const svg = prop(name, 500, 900, { state, focal: true });
        assert.ok(!/NaN|undefined/.test(svg), `${name} ${state}`);
        assert.doesNotMatch(svg, NO_HAND, `${name} ${state}`);
        for (const m of svg.matchAll(/<(path|polygon|rect|circle|ellipse)\b[^>]*>/g)) {
          const tag = m[0];
          const fill = /fill="([^"]+)"/.exec(tag)?.[1];
          const stroke = /stroke="([^"]+)"/.exec(tag)?.[1];
          if (fill && fill !== 'none' && stroke) assert.notEqual(stroke.toUpperCase(), HX.TOKENS.ink.toUpperCase(), `${name} ${state}: ${tag.slice(0, 120)}`);
        }
      }
    }
  }
});

test('openers and the close draw with no wobble filter', async () => {
  const { D } = await load();
  const close = (await import('../explainers/world-kit/close.js')).default;
  assert.doesNotMatch(close.draw(1.5), /wobble/);
  const { DRAW } = await import('../explainers/world-kit/openers/index.js');
  const { openerTiming } = await import('../explainers/world-kit/openers/bank.js');
  const hook = { ground: 'paper', shots: [], hero: null, draw: () => '' };
  for (const [key, draw] of Object.entries(DRAW as Record<string, (t: number, ctx: unknown) => string>)) {
    const M = openerTiming(key, 3, [{ text: 'this', start: 1.36 }]);
    for (const t of [0.1, M.breakAt - 0.05, M.breakAt + 0.3]) {
      D.scope('f01-', 'paper');
      const svg = draw(t, { hook, M, term: 'prompt caching' });
      assert.ok(!/NaN|undefined/.test(svg), `${key} ${t}`);
      assert.doesNotMatch(svg, /url\(#f01-wobble\)/, `${key} ${t}`);
    }
  }
});

test('no opener in the bank draws the title card (4.3: the visual hook owns the opening shot; the card is the hand-off\'s)', async () => {
  const { D } = await load();
  const { DRAW } = await import('../explainers/world-kit/openers/index.js');
  const { OPENERS, openerTiming } = await import('../explainers/world-kit/openers/bank.js');
  const { OPENER_TITLE } = await import('../explainers/world-kit/openers/common.js');
  assert.equal(OPENER_TITLE, false);
  const term = 'model routing';
  const heroes = [null, { at: [600, 1400], s: 1.4, who: 'hero', critter: { body: 'orange' } }];
  assert.deepEqual(Object.keys(DRAW).sort(), OPENERS.map((o: { key: string }) => o.key).sort());
  for (const { key } of OPENERS as { key: string }[]) {
    const M = openerTiming(key, 3.2, [{ text: 'this', start: 1.2 }]);
    assert.ok(M.titleAt >= M.breakAt, `${key}: its timing is unchanged`);
    for (const hero of heroes) {
      const hook = { ground: 'paper', shots: [], hero, draw: () => '' };
      for (const t of [0.2, M.titleAt + 0.3, M.duration - 0.05]) {
        D.scope('f01-', 'paper');
        const svg = (DRAW as Record<string, (t: number, ctx: unknown) => string>)[key](t, { hook, M, term });
        assert.doesNotMatch(svg, /data-role="title"/, `${key}: a title card at ${t}s`);
        assert.ok(!svg.includes(`data-text="${term}"`), `${key}: the term at ${t}s`);
      }
    }
  }
});

test("heroAt reads the hero's projected layout spot and box; heroCritter draws it as the frame does", async () => {
  const { D } = await load();
  const { heroAt, heroCritter } = await import('../explainers/world-kit/openers/common.js');
  D.scope('f01-', 'paper');
  const M = { voiceAt: 0, voice: 3 };
  // a plain hero: feet and scale, no crop
  const plain = (heroAt as any)({ hook: { shots: [], hero: { at: [600, 1400], s: 1.5, critter: { body: 'orange' } } }, M }, 0);
  assert.deepEqual([plain.x, plain.y, plain.s], [600, 1400, 1.5]);
  assert.deepEqual(plain.eye, [600 - 25 * 1.5, 1400 - 98 * 1.5]);
  // a projected box: the middle is its centre, and a shot's 2D crop moves it with the feet
  const boxed = { shots: [{ at: 0, kind: 'close', on: [600, 1300] }], hero: { at: [600, 1400], s: 1.5, box: [470, 1150, 730, 1410], critter: { body: 'orange' } } };
  const h = (heroAt as any)({ hook: boxed, M }, 0);
  assert.ok(Math.abs((h.box[0] + h.box[2]) / 2 - h.mid[0]) < 1e-9 && Math.abs((h.box[1] + h.box[3]) / 2 - h.mid[1]) < 1e-9);
  assert.ok(Math.abs((h.box[2] - h.box[0]) - 260 * (h.s / 1.5)) < 1e-6, 'the box scales with the crop');
  // a hook that draws its own hero: the opener's copy is that drawing, moved and scaled
  const own = heroCritter({ hook: { shots: [], hero: { at: [600, 1400], s: 1.5, critter: {}, draw: () => '<g data-own="1"></g>' } } }, 540, 1000, 3);
  assert.match(own, /data-own="1"/);
  assert.match(own, /translate\(540\.00 1000\.00\) scale\(2\.00000\) translate\(-600\.00 -1400\.00\)/);
  // a lens-lit hero: projected from the lens when at/s are left out, and drawn through critterAt
  const { lens } = await import('../explainers/world-kit/lens.js');
  const P = (lens as any)({ pos: [0, -600, 220], target: [0, 0, 40] });
  const lensHook = { shots: [], hero: { lens: { P, at: [0, 0, 0] }, critter: { body: 'orange' } } };
  const lh = (heroAt as any)({ hook: lensHook, M }, 0);
  const feet = P(0, 0, 0);
  assert.ok(Math.abs(lh.x - feet[0]) < 1e-6 && Math.abs(lh.y - feet[1]) < 1e-6);
  assert.ok(lh.s > 0 && lh.box[3] > lh.box[1]);
  const copy = heroCritter({ hook: lensHook }, 540, 1200, lh.s * 2, { mood: 'happy' });
  assert.match(copy, /data-frame-kind="critter"/, 'the lit critter, as the frame draws it');
  assert.ok(!/NaN|undefined/.test(copy));
});

// ── 4.1 Phase 2: one tone resolver, a red ramp, unknown colors throw ────────────────────────

test('4.1 colors: a red ramp in TOKENS; lens and draw solids resolve tokens and mixes, unknown names throw', async () => {
  const { D } = await load();
  const L: any = await import('../explainers/world-kit/lens.js');
  const S: any = await import('../explainers/world-kit/set.js');
  for (const k of ['red', 'red-lit', 'red-shade', 'red-dark']) assert.match((HX.TOKENS as Record<string, string>)[k], /^#[0-9A-F]{6}$/, k);
  assert.ok(HX.PALETTE.includes('red'));
  assert.equal(HX.ramp('red').base, HX.TOKENS.red);
  assert.equal(D.tonesOf('red'), D.TONES.red);
  // a token, a mix and a hex resolve to their own colors, never paper
  assert.equal(D.tonesOf('ink-lit').base, HX.TOKENS['ink-lit']);
  assert.equal(D.tonesOf('green-shade').base, HX.TOKENS['green-shade']);
  const m = D.tonesOf({ mix: ['paper-shade', 'yellow-dark', 0.4] });
  assert.equal(m.base, HX.mixHex(HX.TOKENS['paper-shade'], HX.TOKENS['yellow-dark'], 0.4));
  assert.notEqual(m.base, D.TONES.paper.base);
  assert.equal(D.tonesOf(undefined), D.TONES.paper, 'nothing given is paper');
  // set.js tone() is the same resolver
  assert.equal(S.tone('ink-lit'), HX.TOKENS['ink-lit']);
  assert.equal(S.tone('teal'), 'teal');
  assert.equal(S.tone({ mix: ['paper', 'teal', 0.3] }), HX.resolveTone({ mix: ['paper', 'teal', 0.3] }));
  assert.equal(S.tone(undefined), 'paper');
  // unknown colors throw with the allowed names, everywhere
  for (const f of [() => D.tonesOf('crimson'), () => S.tone('crimson'), () => HX.resolveTone({ mix: ['paper', 'nope'] })]) assert.throws(f, /unknown color[\s\S]*red-lit/);
  // a lens solid in a token is drawn in that token's ramp (it rendered white before)
  D.scope('tone-', 'paper');
  const P = L.lens({ pos: [0, -400, 120], target: [0, 0, 40] });
  const R = L.rig(P, { ground: 'paper' });
  const fills = (svg: string) => new Set([...svg.matchAll(/stop-color="(#[0-9A-F]{6})"|fill="(#[0-9A-F]{6})"/gi)].map((x) => (x[1] ?? x[2]).toUpperCase()));
  const ink = fills(L.box(P, [-20, -20, 0], [40, 40, 40], 'ink-lit', R).svg);
  const paper = fills(L.box(P, [-20, -20, 0], [40, 40, 40], 'paper', R).svg);
  assert.ok(![...ink].some((c) => paper.has(c)), 'an ink-lit box shares no face color with a paper one');
  assert.throws(() => L.cylinder(P, [0, 0, 0], 10, 20, 'crimson', R), /unknown color/);
  assert.ok(L.isOrange('orange-lit') && L.isOrange({ mix: ['orange', 'paper', 0.2] }) && !L.isOrange('red'));
});

test('K7: the kit imports in plain Node (no loader hook, no network): ceilingShare and fitCeiling work', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const S = await import(${JSON.stringify(path.resolve('explainers/world-kit/set.js'))});
    const K = await import(${JSON.stringify(path.resolve('explainers/world-kit/lens.js'))});
    const G = await import(${JSON.stringify(path.resolve('explainers/world-kit/glass.js'))});
    const D = await import(${JSON.stringify(path.resolve('explainers/world-kit/draw.js'))});
    const cam = S.fitCeiling({ pos: [0, -500, 140], target: [0, 100, 90], fov: 46 }, { x: [-250, 250], y: [-600, 220], h: 280 });
    console.log(JSON.stringify({ share: S.ceilingShare(K.lens(cam), { x: [-250, 250], y: [-600, 220], h: 280 }), route: typeof G.route, ink: D.freehand([[0, 0], [10, 10], [20, 0]]).startsWith('M ') }));
  `], { encoding: 'utf8', timeout: 20000 });
  const out = JSON.parse(r.stdout || '{}');
  assert.ok(out.share > 0 && out.share <= 0.12 && out.route === 'function' && out.ink, r.stderr);
});

test('K9: glass stepTracker numbers and labels read at 4.5:1 through the whole light-up; pointMap dims labels by colour', async () => {
  const { D } = await load();
  const G: any = await import('../explainers/world-kit/glass.js');
  const X: any = await import('../explainers/world-kit/explain.js');
  const lum = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, k) => a + v * [0.2126, 0.7152, 0.0722][k], 0);
  const cr = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  D.scope('k9-', 'paper');
  const gb = G.ramp('green').base;
  for (const lit of [0, 0.25, 0.5, 0.75, 1]) {
    const svg = G.stepTracker(['ask', 'miss', 'fetch'], 1, 200, 800, { lit }).svg;
    const num = [...svg.matchAll(/<text[^>]*fill="(#[0-9A-F]{6})"[^>]*>2</gi)][0][1];
    assert.ok(cr(num, HX.mixHex(gb, HX.TOKENS['paper-lit'], 0.55 * (1 - lit))) >= 4.5, `the lit number at ${lit}`);
    for (const m of svg.matchAll(/<text[^>]*fill="(#[0-9A-F]{6})"[^>]*>(ask|fetch|3)</gi)) assert.ok(cr(m[1], HX.TOKENS.paper) >= 4.5, `${m[2]} at ${lit}`);
  }
  const pts = [{ x: 0.1, y: 0.1, text: 'far one' }, { x: 0.8, y: 0.8, text: 'near' }];
  const pm = X.pointMap(120, 700, 800, 600, pts, { query: { x: 0.82, y: 0.82, text: 'q' }, k: 1, progress: 1 });
  const far = [...pm.svg.matchAll(/<text[^>]*fill="(#[0-9A-F]{6})"[^>]*>far one</gi)][0];
  assert.ok(far && cr(far[1], HX.TOKENS.paper) >= 4.5, 'a far label dims by colour, still ≥ 4.5:1');
  assert.ok(!/<g opacity="0\.\d+"><text[^>]*>far one/.test(pm.svg), 'no label faded by opacity');
});
