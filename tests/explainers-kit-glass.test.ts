/**
 * Explainers visual system 4.0 (hx-4), glass and gloss (approved still 10): glass.js components and the
 * glass restyle of cards.js. Offline: pure SVG strings checked in Node (try.mjs stubs the CDN ink). No
 * model, no browser.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const KIT = path.join(process.cwd(), 'explainers', 'world-kit');

async function kit() {
  await import('../explainers/world-kit/try.mjs'); // registers the CDN stub
  const D = await import('../explainers/world-kit/draw.js');
  const G = await import('../explainers/world-kit/glass.js');
  const C = await import('../explainers/world-kit/cards.js');
  const { frameProblems } = await import('../explainers/world-kit/try.mjs');
  return { D, G, C, frameProblems };
}

const clean = (svg: string) => {
  assert.equal(typeof svg, 'string');
  assert.ok(!/NaN|undefined|Infinity|\[object Object\]/.test(svg), svg.slice(0, 300));
};

test('glass.js is self-contained: kit imports only, no CDN, palette colours only (V-T1)', async () => {
  const src = fs.readFileSync(path.join(KIT, 'glass.js'), 'utf8');
  assert.ok(!/https?:\/\//.test(src.replace(/^\s*\/\/.*$/gm, '')), 'no network import');
  for (const m of src.matchAll(/^import .* from '([^']+)'/gm)) assert.match(m[1], /^\.\/[a-z-]+\.js$/, `imports ${m[1]}`);
  const { HX } = { HX: await import('../explainers/world-kit/core.js') };
  const allowed = new Set(Object.values(HX.TOKENS).map((c) => String(c).toUpperCase()));
  for (const h of src.match(/#[0-9A-Fa-f]{6}\b/g) ?? []) assert.ok(allowed.has(h.toUpperCase()), `glass.js uses ${h}`);
});

test('uiIcon: the vendored Lucide subset covers the real-tech beats, centred and sized', async () => {
  const { D, G } = await kit();
  D.scope('i-', 'paper');
  const need = ['cpu', 'chip', 'router', 'split', 'database', 'search', 'file', 'globe', 'lock', 'key', 'mail', 'message', 'bolt', 'check', 'x', 'clock', 'user', 'users', 'server', 'cloud', 'code', 'link', 'image', 'layers', 'sparkles', 'arrow-right', 'settings', 'shield', 'credit-card', 'shopping-cart', 'bell', 'timer'];
  for (const n of need) assert.ok(G.UI_ICONS.includes(n), `missing icon ${n}`);
  const svg = G.uiIcon('cpu', 100, 200, 48, { color: 'teal' });
  clean(svg);
  assert.match(svg, /data-icon="cpu"/);
  assert.match(svg, /translate\(100 200\) scale\(2\) translate\(-12 -12\)/, 'centred on (x, y), 24-unit grid scaled to size');
  assert.match(G.uiIcon('chip', 0, 0), /data-icon="cpu"/, 'aliases resolve');
  assert.throws(() => G.uiIcon('unicorn', 0, 0), /no uiIcon "unicorn"/);
});

test('glassCard: a measured, fitted textbox with its state, ring and badge', async () => {
  const { D, G, C } = await kit();
  D.scope('g-', 'paper');
  const picked = G.glassCard(122, 1338, 340, 218, { title: 'Small model', sub: 'fast, cheap', icon: 'cpu', state: 'picked', accent: 'teal' });
  clean(picked.svg);
  assert.equal(String(picked), picked.svg, 'usable as its svg string');
  assert.deepEqual(picked.box, { x: 122, y: 1338, w: 340, h: 218 });
  assert.match(picked.svg, /data-k="textbox"/);
  assert.match(picked.svg, /<rect data-k="shape" x="122" y="1338" width="340" height="218"/);
  assert.match(picked.svg, /data-state="picked"/);
  assert.match(picked.svg, />Small model<\/text>/);
  assert.match(picked.svg, />fast, cheap<\/text>/);
  assert.match(picked.svg, /data-icon="check"/, 'the ✓ badge');
  assert.ok(!/PICKED/.test(picked.svg), 'no micro-label by default');
  assert.match(G.glassCard(0, 0, 420, 260, { title: 'x', state: 'picked', badge: 'Picked' }).svg, />PICKED<\/text>/, 'a badge word when asked, as a 30px pill');
  assert.match(picked.svg, /data-ui="tile"/, 'the glossy icon tile');
  const idle = G.glassCard(520, 1300, 420, 272, { title: 'Large model', sub: 'powerful, pricey', icon: 'cpu', state: 'idle', accent: 'blue' });
  assert.match(idle.svg, /data-state="idle"/);
  assert.ok(!/data-state="idle" opacity/.test(idle.svg), 'idle text is never dimmed below its contrast');
  assert.ok(!/check/.test(idle.svg));
  // A card lighting up: no ring at lit 0, the ring at lit 1.
  const ringOf = (svg: string) => /stroke-width="2.5"/.test(svg);
  assert.ok(!ringOf(G.glassCard(0, 0, 300, 200, { title: 'x', state: 'picked', lit: 0 }).svg));
  assert.ok(ringOf(G.glassCard(0, 0, 300, 200, { title: 'x', state: 'picked', lit: 1 }).svg));
  // A long title wraps at ≥ 30px within the card's inner width, and the card grows to hold it.
  const long = G.glassCard(0, 0, 400, 130, { title: 'A very long model name', sub: 'that cannot fit', state: 'plain' });
  const rows = [...long.svg.matchAll(/font-size="([\d.]+)" font-family="'Pragmatica Extended'"[^>]*>([^<]+)</g)];
  assert.equal(rows.length, 2, 'two rows');
  for (const r of rows) {
    assert.ok(Number(r[1]) >= 30);
    assert.ok(C.textWidth(r[2], Number(r[1]), 'pragmatica-700') <= 400 - 2 * 22 + 0.5, r[2]);
  }
  assert.ok(long.box.h > 130, `grew to ${long.box.h}`);
  assert.throws(() => G.glassCard(0, 0, 10, 10, { state: 'chosen' as never }), /state "chosen"/);
  assert.throws(() => G.glassCard(0, 0, 10, 10, { accent: 'pink' }), /glass colour "pink"/);
});

test('chatBubble: user bubbles hang from their right edge, replies from their left; they pop and type in', async () => {
  const { D, G, C } = await kit();
  D.scope('c-', 'paper');
  const user = G.chatBubble('When does the store close?', 424, 900, { from: 'user', maxW: 320 });
  clean(user.svg);
  assert.ok(Math.abs(user.box.x + user.box.w - 424) < 0.01, 'right edge at x');
  assert.ok(user.box.w <= 320 + 0.01);
  assert.equal((user.svg.match(/<text data-k="text"/g) ?? []).length, 2, 'wrapped onto two measured lines');
  assert.match(user.svg, /data-k="textbox"/);
  assert.match(user.svg, /data-k="shape"/);
  const ai = G.chatBubble('We close at 9.', 150, 900, { from: 'ai' });
  assert.equal(ai.box.x, 150, 'left edge at x');
  assert.ok(ai.box.w >= C.textWidth('We close at 9.', 34, 'roboto-500'), 'default 34px');
  // progress: nothing at 0, the bubble with no words yet at 0.2, every word by 1.
  assert.equal(G.chatBubble('hi there', 0, 0, { progress: 0 }).svg, '');
  const opac = (svg: string) => [...svg.matchAll(/<tspan opacity="([\d.]+)"/g)].map((x) => Number(x[1]));
  assert.ok(opac(G.chatBubble('one two three four', 500, 500, { progress: 0.2 }).svg).every((o) => o === 0));
  const half = opac(G.chatBubble('one two three four', 500, 500, { progress: 0.6 }).svg);
  assert.ok(half[0] === 1 && half[3] === 0, `${half}`);
  assert.ok(opac(G.chatBubble('one two three four', 500, 500).svg).every((o) => o === 1));
  // The typing bubble has dots and no text; "Sent" sits outside the bubble's textbox.
  const typing = G.chatBubble('', 100, 100, { from: 'ai', typing: 0.3 });
  assert.equal((typing.svg.match(/<circle/g) ?? []).length, 3);
  assert.ok(!/data-k="text"/.test(typing.svg));
  const sent = G.chatBubble('ok', 400, 100, { meta: 'Sent' }).svg;
  assert.ok(sent.indexOf('>Sent</text>') > sent.lastIndexOf('</g>', sent.indexOf('>Sent</text>')), 'meta after the textbox group closes');
  assert.throws(() => G.chatBubble('x', 0, 0, { from: 'bot' as never }), /from "bot"/);
});

test('pill: a chip sized around its tracked capitals, centred on (x, y)', async () => {
  const { D, G } = await kit();
  D.scope('p-', 'paper');
  const p = G.pill('Router', 784, 810, { dot: true });
  clean(p.svg);
  assert.ok(Math.abs(p.box.x + p.box.w / 2 - 784) < 0.01 && Math.abs(p.box.y + p.box.h / 2 - 810) < 0.01);
  assert.match(p.svg, />ROUTER<\/text>/);
  assert.match(p.svg, /font-size="30"/, '30px by default');
  assert.match(p.svg, /letter-spacing="3.6"/, '0.12em at 30px');
  assert.ok(p.box.w > G.measure('ROUTER', 30, 'roboto-700', 0.12));
  assert.match(G.pill('x', 0, 0, { size: 14 }).svg, /font-size="30"/, 'never under 30px');
  assert.match(G.pill('Picked', 0, 0, { tone: 'tint', icon: 'check', color: 'teal' }).svg, /data-icon="check"/);
  assert.match(G.pill('128 tokens', 0, 0, { caps: false }).svg, />128 tokens<\/text>/);
});

test('route and packet: one path, arc-length progress, the packet riding it', async () => {
  const { D, G } = await kit();
  D.scope('r-', 'paper');
  const pts = [[440, 905], [700, 934]];
  const a = G.routeAt(pts, 0, { bend: 'h' });
  const b = G.routeAt(pts, 1, { bend: 'h' });
  assert.ok(Math.abs(a.x - 440) < 0.01 && Math.abs(a.y - 905) < 0.01);
  assert.ok(Math.abs(b.x - 700) < 0.01 && Math.abs(b.y - 934) < 0.01);
  assert.ok(Math.abs(G.routeAt(pts, 0.5, { bend: 'h' }).angle) < 20, 'h handles leave and arrive level');
  assert.match(G.routePath(pts, { bend: 'h' }), /^M 440 905 C 570 905, 570 934, 700 934$/);
  const unlit = G.route(pts, { bend: 'h', progress: 0 });
  clean(unlit);
  assert.equal((unlit.match(/<path/g) ?? []).length, 1, 'just the hairline track');
  const lit = G.route(pts, { bend: 'h', progress: 1, color: 'teal' });
  assert.match(lit, /<circle/, 'the node dot once it arrives');
  assert.match(G.route(pts, { dashed: true }), /stroke-dasharray="2 9"/);
  assert.equal(G.packet(pts, 0), '');
  assert.equal(G.packet(pts, 1), '');
  const pk = G.packet(pts, 0.62, { bend: 'h' });
  clean(pk);
  const q = G.routeAt(pts, 0.62, { bend: 'h' });
  assert.ok(pk.includes(`translate(${Math.round(q.x * 100) / 100} ${Math.round(q.y * 100) / 100})`), 'the capsule sits on the route at u');
  assert.throws(() => G.route([[0, 0]]), /at least two points/);
});

test('phone: a screen that is its textbox shape, a header, messages stacked, children placed on it', async () => {
  const { D, G } = await kit();
  D.scope('f-', 'paper');
  type Area = { top: number; bottom: number; left: number; right: number; next: number };
  const seen: Area[] = [];
  const svg = G.phone(116, 600, {
    messages: [{ text: 'When does the store close?', meta: 'Sent' }, { from: 'ai', typing: 0.4 }],
    children: (a: Area) => {
      seen.push(a);
      return '<g data-test="child"></g>';
    },
  });
  clean(svg);
  assert.match(svg, /data-ui="phone"/);
  assert.match(svg, /<rect data-k="shape" x="127.31" y="611.31" width="357.38" height="637.38"/, 'the screen (380 × 660)');
  assert.match(svg, /font-size="30"[^>]*>New chat<\/text>/);
  assert.ok(!/9:41/.test(svg), 'no unreadable status clock');
  assert.match(svg, /data-test="child"/);
  const area = seen[0];
  assert.ok(area && area.next > area.top && area.right > area.left);
  assert.match(svg, /<mask /, 'the lower third fades into the paper');
  assert.ok(!/<mask /.test(G.phone(0, 0, { fade: false })));
});

test('glossTile, glassPanel and glassGround: pure, scoped ids, both grounds', async () => {
  const { D, G } = await kit();
  D.scope('t-', 'paper');
  const tile = G.glossTile(784, 934, 140, { icon: 'split', iconRotate: 180 });
  clean(tile);
  assert.equal(tile, G.glossTile(784, 934, 140, { icon: 'split', iconRotate: 180 }), 'a pure function of its arguments');
  assert.match(tile, /id="t-gl-/, 'def ids carry the shot scope');
  assert.match(tile, /rotate\(180\)/);
  assert.ok(G.glossTile(0, 0, 80, { lit: 0 }).includes('fill-opacity="0.4"'), 'an unlit tile sits back');
  assert.equal(G.glossTile(0, 0, 80, { appear: 0 }), '');
  assert.throws(() => G.glossTile(0, 0, 80, { color: 'magenta' }), /glass colour "magenta"/);
  const light = G.glassGround();
  clean(light);
  D.scope('s-', 'stage');
  const dark = G.glassGround();
  assert.notEqual(light, dark);
  assert.match(G.glassPanel(0, 0, 200, 100, 20), /<mask /, 'shadows never paint under translucent glass');
});

test('cards (hx-4): glass and gloss, no wobble, same roles, boxes and timing', async () => {
  const { D, C, frameProblems } = await kit();
  D.scope('k-', 'paper');
  const words = 'An agent loop is the cycle an AI agent repeats until its goal is met.'.split(' ').map((text, i) => ({ text, start: 0.2 + i * 0.3 }));
  const dict = C.dictionaryCard(9, { headword: 'agent loop', words });
  const title = C.titleCard(3, { term: 'agent loop', to: 3 });
  for (const svg of [dict.svg, title]) {
    clean(svg);
    assert.deepEqual(frameProblems(svg), []);
    assert.ok(!/wobble/.test(svg), 'no hand tremor (hx-4)');
    assert.match(svg, /<mask /, 'a glass panel');
  }
  assert.match(dict.svg, />NOUN<\/tspan>/, 'the part of speech chip');
  assert.equal(C.TITLE_LANDS, 0.25);
  assert.deepEqual(C.TITLE_BAND, { x: 150, y: 250, w: 780, h: 280 });
  assert.match(C.titleCard(0.3, { term: 'agent loop', to: 3 }), /data-role="title" transform="translate\(0 0\.00\) rotate\(0 /, 'landed, level');
  for (const kind of C.BOX_KINDS) {
    const opts: { focal?: boolean; tail?: 'left' | 'right' | 'none'; hand?: boolean }[] = [{}, { focal: true }, { tail: 'right' }, { tail: 'none', hand: false }];
    for (const o of opts) {
      const b = C.textBox('happy to help!', 540, 900, { kind, ...o });
      clean(b.svg);
      assert.deepEqual(frameProblems(b.svg), [], `${kind} ${JSON.stringify(o)}`);
      const s = /<rect data-k="shape" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(b.svg);
      assert.ok(s, `${kind}: shape rect`);
      assert.deepEqual(s!.slice(1).map(Number), [b.box.x, b.box.y, b.box.w, b.box.h].map((v) => Number(v.toFixed(1))));
    }
  }
});

test('stepTracker: numbered stops, done / current / upcoming, the rail lit to the current stop', async () => {
  const { D, G, frameProblems } = await kit();
  D.scope('st-', 'paper');
  const steps = ['Embed the question', 'Search the index', 'Rank the chunks', 'Write the answer'];
  const t = G.stepTracker(steps, 2, 96, 700);
  clean(t.svg);
  assert.deepEqual(frameProblems(t.svg), []);
  assert.equal(String(t), t.svg);
  assert.deepEqual(t.stops.map((s: { x: number; y: number }) => [s.x, s.y]), [[128, 732], [128, 882], [128, 1032], [128, 1182]]);
  assert.deepEqual([...t.svg.matchAll(/data-ui="stop" data-state="(\w+)"/g)].map((m) => m[1]), ['done', 'done', 'current', 'upcoming']);
  for (const s of steps) assert.ok(t.svg.includes(`>${s}</text>`), s);
  assert.match(t.svg, />3<\/text>/, 'the current stop shows its number');
  assert.equal((t.svg.match(/data-icon="check"/g) ?? []).length, 2, 'done stops show ✓');
  // The rail is lit up to the current stop: two of three spans at lit 1, half a span less at lit 0.5.
  const reach = (svg: string) => /<path d="M ([\d.]+) ([\d.]+)(?: L [\d.]+ [\d.]+)* L [\d.]+ ([\d.]+)" fill="none" stroke="[^"]+" stroke-width="4"/.exec(svg);
  assert.ok(reach(t.svg) && Math.abs(Number(reach(t.svg)![3]) - 1032) < 1);
  assert.ok(Math.abs(Number(reach(G.stepTracker(steps, 2, 96, 700, { lit: 0.5 }).svg)![3]) - 957) < 1);
  const h = G.stepTracker(steps, 0, 120, 1400, { axis: 'h', gap: 240 });
  assert.equal(h.stops[3].x, 120 + 32 + 720);
  assert.throws(() => G.stepTracker([], 0, 0, 0), /needs its steps/);
});

test('contrast: upcoming stops, idle cards, pills and focal boxes hold 4.5:1 (frame.md V-T2)', async () => {
  const { D, G, C } = await kit();
  const HX = await import('../explainers/world-kit/core.js');
  const T = HX.TOKENS;
  const fills = (svg: string) => [...svg.matchAll(/<text [^>]*fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
  D.scope('k-', 'paper');
  const glass = HX.mixHex(T['paper-lit'], T.paper, 0.5);
  for (const c of fills(G.stepTracker(['a', 'b', 'c'], 0, 96, 700).svg)) assert.ok(G.contrast(c, T.paper) >= 4.5 || G.contrast(c, T[ 'green' ]) >= 4.5, `${c} on paper`);
  for (const c of fills(G.glassCard(0, 0, 400, 240, { title: 'Large model', sub: 'powerful, pricey', state: 'idle' }).svg)) assert.ok(G.contrast(c, glass) >= 4.5, `idle card ${c}`);
  for (const color of G.GLASS_COLORS) {
    const solid = G.pill('Send', 0, 0, { tone: 'solid', color });
    const c = fills(solid.svg)[0];
    assert.ok(G.contrast(c, G.ramp(color).base) >= 4.5, `solid ${color} pill text ${c}`);
    const tint = fills(G.pill('Cached', 0, 0, { tone: 'tint', color }).svg)[0];
    assert.ok(G.contrast(tint, HX.mixHex(T.canvas, G.ramp(color).base, 0.14)) >= 4.5, `tint ${color} pill text ${tint}`);
  }
  assert.ok(G.contrast(G.onColor(G.ramp('orange').base), G.ramp('orange').base) >= 4.5);
  assert.match(C.textBox('me too!', 540, 900, { focal: true, hand: false }).svg, new RegExp(`fill="${T.ink}"[^>]*>me too!`), 'ink on the glossy orange');
  D.scope('kd-', 'stage');
  for (const c of fills(G.stepTracker(['a', 'b', 'c'], 0, 96, 700).svg).slice(1)) assert.ok(G.contrast(c, T['stage-top']) >= 4.5, `${c} on the stage`);
});

test('every glass component draws text a viewer reads at ≥ 30px; decorative lines ≥ 24px', async () => {
  const { D, G, C } = await kit();
  for (const ground of ['paper', 'stage']) {
    D.scope(`m-${ground}-`, ground);
    const svgs = [
      G.phone(100, 600, { messages: [{ text: 'When does the store close?', meta: 'Sent' }, { from: 'ai', text: 'At 9 pm tonight, see you then.', progress: 0.7 }] }),
      G.chatBubble('A long reply that has to wrap onto several rows to fit', 100, 100, { from: 'ai', maxW: 300, size: 20 }).svg,
      ...(['picked', 'idle', 'plain'] as const).flatMap((state) => [
        G.glassCard(0, 0, 260, 120, { title: 'Embedding model', sub: 'turns words into numbers', icon: 'cpu', state }).svg,
        G.glassCard(0, 0, 420, 260, { title: 'x', sub: 'y', state, badge: 'Status' }).svg,
      ]),
      ...(['glass', 'tint', 'solid'] as const).map((tone) => G.pill('A label', 0, 0, { tone, dot: true, size: 12 }).svg),
      G.stepTracker(['Embed the question now please', 'Search', 'Rank', 'Answer'], 1, 96, 600, { size: 20, maxW: 200 }).svg,
      G.stepTracker(['Embed', 'Search the whole index', 'Rank'], 1, 96, 1300, { axis: 'h', gap: 200 }).svg,
      C.dictionaryCard(9, { headword: 'retrieval augmented generation pipelines', size: 20, words: [{ text: 'word', start: 0 }] }).svg,
      ...C.BOX_KINDS.map((kind) => C.textBox('a fairly long line of text for this box', 540, 900, { kind, hand: false, size: 16, maxW: 300 }).svg),
    ];
    for (const svg of svgs) {
      clean(svg);
      for (const m of svg.matchAll(/<text ([^>]*)>/g)) {
        const size = Number(/font-size="([\d.]+)"/.exec(m[1])?.[1]);
        const min = /data-decor="1"/.test(m[1]) ? 24 : 30;
        assert.ok(size >= min, `text at ${size}px (min ${min}): <text ${m[1].slice(0, 80)}>`);
      }
    }
  }
  // Handwritten boxes keep their cap height at ≥ 30px too: a long note takes more lines instead.
  D.scope('m-h-', 'paper');
  const note = C.textBox('your order ships tomorrow morning from our main warehouse', 540, 900, { kind: 'speech', size: 34, maxW: 420 });
  assert.ok(note.box.w <= 420 + 0.01);
  assert.ok((note.svg.match(/data-k="text"/g) ?? []).length > 2, 'more lines, not a smaller size');
});

