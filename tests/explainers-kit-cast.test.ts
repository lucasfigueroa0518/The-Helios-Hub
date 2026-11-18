/**
 * Explainers hx-6 cast (critter D behind main's critter API, VISUAL_SYSTEM_6 §3–§4), offline:
 * critterTile is the reference drawing byte for byte (reference/critter-d SVGs, whitespace and
 * empty classes normalised); critter() keeps main's signature and options (moods by main's names,
 * the rig's arms, views, squash, held props, the look key) and draws critter D: no mouth, brows,
 * gloss, gradient or garment; orange only on the hero's body; main's outfits and stock wear become
 * a wear.js role or nothing; wear.js draws the 17 roles and wearProblems holds the static rules.
 * No model, no browser.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const REF = new URL('../explainers/world-kit/reference/critter-d/', import.meta.url);
// try.mjs stubs the CDN import draw.js makes (perfect-freehand), as in the kit tests.
async function kit() {
  await import('../explainers/world-kit/try.mjs');
  const draw: any = await import('../explainers/world-kit/draw.js');
  const cast: any = await import('../explainers/world-kit/cast.js');
  const wear: any = await import('../explainers/world-kit/wear.js');
  return { draw, cast, wear };
}

// The reference sheet's own accessories (critter_d.py acc()): the cap, beanie, chef's hat and bow
// tie there are the old ones, kept only to match the reference files; the kit ships wear.js pieces.
const INK = '#171717';
const WHITE = '#FFFFFF';
function refProp(kind: string, bodyHex: string) {
  const c = bodyHex === INK ? WHITE : INK;
  if (kind === 'cap') return `<path d="M44 66 Q48 22 100 20 Q152 22 156 66 Z" fill="${c}"></path><path d="M120 62 L178 62 Q182 70 170 72 L120 72 Z" fill="${c}"></path>`;
  if (kind === 'beanie') return `<path d="M40 62 Q42 18 100 16 Q158 18 160 62 Z" fill="${c}"></path><circle cx="100" cy="12" r="10" fill="${c}"></circle>`;
  if (kind === 'chef') return `<path d="M62 56 L62 34 Q50 30 54 16 Q62 2 78 10 Q88 -2 100 6 Q112 -2 122 10 Q138 2 146 16 Q150 30 138 34 L138 56 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="3"></path>`;
  if (kind === 'bowtie') return `<path d="M100 160 L80 150 L80 172 Z M100 160 L120 150 L120 172 Z" fill="${c}"></path><circle cx="100" cy="161" r="5" fill="${c}"></circle>`;
  throw new Error(kind);
}
const CAST_REFS: Record<string, [string, string, string]> = {
  'cast-barista-green-sleepy': ['sleepy', 'green', 'beanie'],
  'cast-builder-white-focused': ['focused', 'white', 'cap'],
  'cast-cook-ink-happy': ['happy', 'ink', 'chef'],
  'cast-developer-ink-curious': ['curious', 'ink', 'headphones'],
  'cast-host-white-proud': ['proud', 'white', 'bowtie'],
  'cast-librarian-green-sly': ['sly', 'green', 'glasses'],
};
const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/ class=""/g, '').replace(/>\s+</g, '><').trim();
const SHADOW = '<ellipse cx="100" cy="192" rx="58" ry="7" fill="#171717" fill-opacity="0.10"></ellipse>';
const inner = (svg: string) => norm(svg).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(SHADOW, '');
/** The critter's own drawing: its SVG without the defs and the contact shadow (main's, unchanged). */
const figure = (svg: string) => svg.replace(/<defs[\s\S]*?<\/defs>/, '').replace(/<g transform="scale\([\d.]+ [\d.]+\)">(<ellipse[^>]*><\/ellipse>){4}<\/g>/, '');

test('critter D matches every reference SVG exactly (whitespace and empty classes normalised)', async () => {
  const { cast } = await kit();
  const files = readdirSync(REF).filter((f) => f.endsWith('.svg'));
  assert.ok(files.length >= 19, `the reference set is there (${files.length})`);
  for (const file of files) {
    const key = file.replace(/\.svg$/, '');
    let o: Record<string, unknown>;
    if (key.startsWith('hero-')) o = { body: 'orange', mood: key.slice(5) };
    else if (CAST_REFS[key]) {
      const [mood, body, prop] = CAST_REFS[key];
      o = { mood, body };
      if (prop === 'glasses' || prop === 'headphones') o.head = prop; // the kit's own head pieces
      else o._overlay = refProp(prop, cast.D.BODY_COLORS[body]);
    } else {
      const m = key.match(/^cast-(\w+)-neutral$/);
      assert.ok(m, `unexpected reference ${file}`);
      o = { body: m![1], mood: 'neutral' };
    }
    assert.equal(norm(cast.D.tile(o)), inner(readFileSync(new URL(file, REF), 'utf8')), file);
  }
});

test('critter() draws critter D in every main mood and D mood, on every body: no mouth, brows, gloss or gradient', async () => {
  const { draw, cast } = await kit();
  draw.scope('d-', 'paper');
  // the reference ten first (byte for byte, above), then the twenty acting.js adds
  assert.deepEqual(Object.keys(cast.D.MOODS).slice(0, 10), ['neutral', 'happy', 'curious', 'focused', 'surprised', 'sly', 'worried', 'angry', 'proud', 'sleepy']);
  assert.equal(Object.keys(cast.D.MOODS).length, 29);
  assert.deepEqual(cast.BODIES.slice(0, 4), ['orange', 'green', 'ink', 'white']);
  for (const mood of Object.keys(cast.MOODS)) assert.ok(cast.D.MOODS[cast.D.dMood(mood)], `${mood} maps to a D mood`);
  for (const body of cast.BODIES) {
    for (const mood of [...Object.keys(cast.MOODS), ...Object.keys(cast.D.MOODS)]) {
      const svg = cast.critter(540, 1400, { body, mood, s: 1.2, flip: mood === 'sly', who: 'c' });
      assert.doesNotMatch(svg, /data-rig=/, `${mood} ${body}: a clean pose`);
      const fig = figure(svg);
      assert.doesNotMatch(svg, /undefined|NaN/, `${mood} ${body}`);
      const hex = cast.D.BODY_COLORS[cast.D.bodyName(body)];
      assert.ok(fig.includes(`<rect x="26" y="40" width="148" height="136" rx="46" fill="${hex}"`), `${mood} ${body}: D's body`);
      assert.equal((fig.match(/<ellipse cx="(74|126)" cy="96" rx=/g) ?? []).length, 2, `${mood} ${body}: two eye whites`);
      assert.doesNotMatch(fig, /Gradient|filter=|url\(#/, `${mood} ${body}: flat: no gradient, gloss or filter`);
      assert.doesNotMatch(fig, /<circle [^>]*fill="#FFFFFF"/, `${mood} ${body}: no catch-light`);
      assert.doesNotMatch(fig, /stroke-width="5\.[25]"/, `${mood} ${body}: no mouth or brows`);
      if (body !== 'orange') assert.doesNotMatch(svg, /#FF5E1A|#FF9462|#E24213|#A02B02/i, `${mood} ${body}: no orange on a cast member`);
    }
  }
  // paper is white (§3); the old light bodies draw white too; unknown bodies throw
  assert.equal(cast.D.bodyName('paper'), 'white');
  assert.match(cast.critter(0, 0, { body: 'paper' }), /data-critter="white"/);
  assert.throws(() => cast.critter(0, 0, { body: 'pink' }), /body "pink" must be one of orange, green, ink, white/);
  // mouth and brows are accepted and ignored
  assert.equal(figure(cast.critter(0, 0, { mood: 'happy', mouth: 'grin', brows: 'angry' })), figure(cast.critter(0, 0, { mood: 'happy' })));
  // the explicit face options: a blink shuts the lids, a glance moves the pupils, pr picks small pupils
  assert.match(cast.critter(0, 0, { lid: 1 }), /<polygon points="50,67 98,67 98,123 50,123"/);
  assert.match(cast.critter(0, 0, { look: [1, 0] }), /<g transform="translate\(6 0\)"><circle/);
  assert.match(cast.critter(0, 0, { pr: 0.3 }), /<circle cx="74" cy="96" r="8" fill/);
});

test('the frame: s 1 is CRITTER_PX from the feet to the top of the body; the tile sits on the feet', async () => {
  const { cast } = await kit();
  assert.equal(Math.round(cast.D.DK * (cast.D.TILE.feet - cast.D.TILE.top) * 1e9) / 1e9, cast.CRITTER_PX);
  const svg = cast.critter(500, 1000, {});
  assert.match(svg, /transform="translate\(500\.00 1000\.00\)"/, 'the feet');
  assert.match(svg, new RegExp(`<g transform="scale\\(${cast.D.DK.toFixed(4)}\\) translate\\(-100 -192\\)">`), 'the tile drawn in the local frame');
  assert.match(cast.BODY_D, /^M [-\d.]+ -142 H/, 'BODY_D: the top of D\'s body at −CRITTER_PX');
});

test('arms: main\'s rig solves them; D draws ink stub arms with mitten ends at the solved hands', async () => {
  const { draw, cast } = await kit();
  draw.scope('a-', 'paper');
  for (const arms of [...Object.keys(cast.ARM_POSES), { l: [-90, -40], r: [130, -120] }]) {
    const svg = cast.critter(0, 0, { arms });
    const sol = cast.solveArms({ arms });
    for (const [i, side] of [[0, 'l'], [1, 'r']] as const) {
      const [hx, hy] = sol.hands[i].map((v: number) => Math.round(v * 100) / 100);
      const part = svg.match(new RegExp(`<g data-part="arm-${side}">([\\s\\S]*?)</g>`))![1];
      assert.match(part, /stroke="#171717" stroke-width="18\.68" stroke-linecap="round"/, `${JSON.stringify(arms)} ${side}: D's ink arm`);
      assert.ok(part.includes(`<circle cx="${hx}" cy="${hy}" r="11.21" fill="#171717">`), `${JSON.stringify(arms)} ${side}: the mitten at the solved hand`);
    }
  }
  // handAt reports D's mitten: the solved hand on screen
  const hs = cast.solveArms({ arms: 'reach' }).hands[1];
  assert.deepEqual(cast.handAt(100, 500, { s: 2, arms: 'reach' }).r, [100 + hs[0] * 2, 500 + hs[1] * 2]);
});

test('D decides the length: no arm in any ARM_POSE, GESTURE or reach runs past critter D\'s stub', async () => {
  const { draw, cast } = await kit();
  draw.scope('stub-', 'paper');
  const len = (sol: any, i: number) => Math.hypot(sol.hands[i][0] - sol.quads[i][0], sol.hands[i][1] - (sol.quads[i][1] + 15));
  const cases: any[] = [...Object.keys(cast.ARM_POSES).map((arms) => ({ arms })), ...Object.keys(cast.GESTURES).map((gesture) => cast.act({ gesture })), cast.act({ reach: [180, -200] }), cast.act({ point: [-200, -150] }), cast.act({ hold: { r: 'mug' }, reach: [150, -150] })];
  for (const o of cases) {
    const sol = cast.solveArms(o);
    for (const i of [0, 1]) {
      const across = sol.front.includes(i ? 'r' : 'l') || Math.abs(sol.hands[i][0]) < 62;
      if (!across) assert.ok(len(sol, i) <= cast.D_STUB + 1e-6, `${JSON.stringify(o.arms ?? o).slice(0, 60)} ${i}: ${len(sol, i).toFixed(1)} > D_STUB`);
    }
    // the drawn mitten is where handAt says
    const svg = cast.critter(0, 0, o);
    const h = cast.handAt(0, 0, o);
    for (const side of ['l', 'r']) {
      const part = svg.match(new RegExp(`<g data-part="arm-${side}">([\\s\\S]*?)</g>`))![1];
      const [, cx, cy] = part.match(/<circle cx="([-\d.]+)" cy="([-\d.]+)"/)!.map(Number);
      assert.ok(Number.isFinite(cx) && Number.isFinite(cy));
    }
    assert.ok(h.l && h.r);
  }
});

test('views: back is D\'s tile with no eyes; front has them; side stays a flip', async () => {
  const { draw, cast } = await kit();
  draw.scope('v-', 'paper');
  const back = cast.critter(0, 0, { view: 'back', body: 'green', who: 'b' });
  assert.match(back, /data-view="back"/);
  assert.doesNotMatch(back, /<ellipse cx="(74|126)" cy="96"/, 'no eyes from behind');
  assert.match(back, /<rect x="26" y="40" width="148" height="136" rx="46" fill="#138510"/);
  assert.equal((back.match(/data-part="arm-[lr]"/g) ?? []).length, 2, 'both arms');
  assert.doesNotMatch(cast.D.tile({ view: 'back' }), /cy="96"/);
  assert.throws(() => cast.critter(0, 0, { view: 'three-quarter' }), /removed in 4.2/);
});

test('outfits and stock wear become a role or nothing: no garment is drawn on a body', async () => {
  const { draw, cast, wear } = await kit();
  draw.scope('o-', 'paper');
  const bare = figure(cast.critter(0, 0, { body: 'green' }));
  for (const outfit of [{ top: { kind: 'scrubs', color: 'teal' } }, { top: { kind: 'apron', color: 'green', under: 'ink' }, items: ['scarf', 'clipboard'] }, { top: { kind: 'jacket', color: 'blue' }, pants: 'ink', shoes: 'ink' }]) {
    assert.equal(figure(cast.critter(0, 0, { body: 'green', outfit })), bare, `${JSON.stringify(outfit)}: bare`);
  }
  assert.deepEqual(cast.D.wearOf({ outfit: { top: { kind: 'apron', color: 'green' }, head: { kind: 'chef' } } }), { role: null, head: 'toque', hand: null, bowtie: false, headTone: null });
  assert.equal(cast.D.wearOf({ outfit: { top: { kind: 'tee', color: 'blue' }, head: { kind: 'hard-hat' } } }).head, 'hardhat');
  assert.equal(cast.D.wearOf({ outfit: { top: { kind: 'waistcoat', color: 'ink' }, items: ['bowtie'] } }).bowtie, true);
  for (const w of cast.WEAR as string[]) {
    const svg = cast.critter(0, 0, { wear: [w] });
    assert.ok(svg.includes(cast.wearDrawing([w]).front), `${w}: the critter draws what it translates to`);
    const t = cast.D.WEAR_TO_ROLE[w];
    if (t?.head) assert.ok(svg.includes(wear.headSvg(t.head, 'ink')), `${w} → ${t.head}`);
    else if (!t) assert.equal(figure(svg), figure(cast.critter(0, 0, {})), `${w}: bare`);
  }
  assert.deepEqual(cast.outfitShapes({ top: { kind: 'scrubs' } }), []);
  assert.ok(!cast.outfitColors({ top: { kind: 'tee', color: 'orange' } }).has('orange'), 'an orange outfit draws no orange');
  // an explicit role wins over a translated outfit
  assert.equal(cast.D.wearOf({ role: 'builder', outfit: { head: { kind: 'chef' } } }).head, 'hardhat');
});

test('the look key: main\'s keys unchanged; a role adds itself; the hand prop is left out', async () => {
  const { draw, cast } = await kit();
  draw.scope('lk-', 'paper');
  const { lookKey, critter } = cast;
  assert.equal(lookKey({ body: 'orange', wear: ['scarf', 'cap'] }), 'orange|cap+scarf|');
  assert.equal(lookKey({ body: 'green' }), 'green||');
  assert.equal(lookKey({ body: 'green', role: 'coach' }), 'green|||role=coach.cap..');
  const svg = critter(0, 0, { who: 'c', body: 'green', role: 'coach', mood: 'happy' });
  assert.ok(svg.startsWith('<g data-who="c" data-look="green|||role=coach.cap.." data-critter="green"'), svg.slice(0, 120));
  assert.equal(/data-look="([^"]+)"/.exec(critter(0, 0, { who: 'c', body: 'green', role: 'coach', hand: null, mood: 'sad', arms: 'hips' }))![1], 'green|||role=coach.cap..');
  const o = { body: 'paper', mood: 'proud', arms: 'carry', role: 'chef' };
  assert.equal(critter(10, 20, o), critter(10, 20, o), 'a frame is a pure function of its arguments');
});

test('squash scales about the feet; hands follow; heldScale sizes a prop from CRITTER_CM', async () => {
  const { draw, cast } = await kit();
  draw.scope('sq-', 'paper');
  const { critter, handAt, heldScale, CRITTER_CM, CRITTER_PX } = cast;
  assert.equal(CRITTER_CM, 72);
  const svg = critter(100, 500, { s: 2, squash: { sx: 1.25, sy: 0.8 } });
  assert.match(svg, /transform="translate\(100\.00 500\.00\)"/, 'the feet stay put');
  assert.match(svg, /scale\(2\.5000 1\.6000\)/, 'the body scales about the feet');
  const hr = cast.solveArms({ arms: 'reach' }).hands[1];
  assert.deepEqual(handAt(100, 500, { s: 2, arms: 'reach', squash: { sx: 1.25, sy: 0.8 } }).r, [100 + hr[0] * 2 * 1.25, 500 + hr[1] * 2 * 0.8]);
  assert.equal(heldScale(72), 1);
  assert.ok(Math.abs(heldScale(12, 50) - (12 * (CRITTER_PX / CRITTER_CM)) / 50) < 1e-12);
  assert.throws(() => heldScale(0), /positive sizes/);
});

test('on the stage: no rim light or glow (no orange on a cast member); an ink body keeps a thin edge', async () => {
  const { draw, cast } = await kit();
  draw.scope('st-', 'stage');
  const ink = cast.critter(0, 0, { body: 'ink' });
  assert.doesNotMatch(ink, /feFlood|#FF9462|#FF5E1A/i);
  assert.match(ink, /fill="#171717" stroke="#2B2926" stroke-width="4"/);
  draw.scope('st2-', 'paper');
  assert.doesNotMatch(cast.critter(0, 0, { body: 'ink' }), /stroke="#2B2926"/);
});

test('wear.js: the closed lists and the 17 roles; every role draws on every body with its pieces', async () => {
  const { draw, cast, wear } = await kit();
  draw.scope('r-', 'paper');
  assert.deepEqual(wear.HEADS, ['toque', 'hardhat', 'nursecap', 'cap', 'beanie', 'gradcap', 'beret', 'fedora', 'sunhat', 'headphones', 'glasses']);
  assert.deepEqual(wear.HANDS, ['cup', 'briefcase', 'book', 'palette', 'tray', 'football', 'docbag', 'magnifier', 'envelope', 'wateringcan', 'flask', 'camera']);
  assert.deepEqual(Object.keys(wear.ROLES), ['chef', 'builder', 'nurse', 'doctor', 'waiter', 'office worker', 'developer', 'librarian', 'barista', 'coach', 'student', 'artist', 'detective', 'mail carrier', 'gardener', 'scientist', 'photographer']);
  for (const [role, R] of Object.entries<any>(wear.ROLES)) {
    const n = [R.head, R.hand, R.bowtie].filter(Boolean).length;
    assert.ok(n >= 1 && n <= 2, `${role}: one or two signifiers`);
    for (const body of ['orange', 'green', 'ink', 'white']) {
      const t = cast.D.tile({ role, body, mood: 'happy' });
      const svg = cast.critter(300, 900, { role, body, mood: 'happy' });
      assert.doesNotMatch(t + svg, /undefined|NaN/, `${role} ${body}`);
      if (body !== 'orange') assert.doesNotMatch(svg, /#FF5E1A/i, `${role} ${body}: no orange on a cast member's wear`);
      if (R.head) assert.ok(svg.includes(wear.headSvg(R.head, body, R.headTone ?? null)), `${role} ${body}: its head piece`);
      if (R.hand) {
        assert.match(svg, new RegExp(`data-held="${R.hand}"`), `${role} ${body}: its prop in hand`);
        const hb = cast.heldBoxes(300, 900, { role, body }).r;
        assert.ok(hb && hb.kind === R.hand, `${role}: its prop has a box`);
        // the prop is in the solved right hand
        const h = cast.handAt(300, 900, { role, body }).r;
        assert.ok(h[0] > hb.box[0] - 30 && h[0] < hb.box[2] + 30 && h[1] > hb.box[1] - 30 && h[1] < hb.box[3] + 30, `${role}: the box is at the hand`);
      }
    }
  }
  assert.match(cast.D.tile({ role: 'chef' }), /<path d="M84 44 V32/);
  assert.match(cast.D.tile({ role: 'waiter' }), /M100 142 L86 135/);
  const down = cast.critter(0, 0, { role: 'coach', hand: null, mood: 'happy' });
  assert.doesNotMatch(down, /data-held/);
  assert.match(down, /rotate\(-6 100 40\)/, 'the cap stays on');
  for (const hand of wear.HANDS) {
    const svg = wear.heldPropSvg(hand, 'orange');
    assert.equal(/<circle cx="[\d.]+" cy="[\d.]+" r="12" fill="#171717"\/>$/.test(svg), !wear.FRONT.includes(hand), `${hand} layering`);
  }
  assert.throws(() => cast.critter(0, 0, { role: 'astronaut' }), /role "astronaut"/);
  assert.throws(() => cast.critter(0, 0, { head: 'crown' }), /head piece "crown"/);
});

test('wearProblems: closed lists, at most two signifiers, and a put-down beat before the hands are used', async () => {
  const { wear } = await kit();
  assert.deepEqual(wear.wearProblems({ role: 'barista' }, []), []);
  assert.deepEqual(wear.wearProblems({ role: 'chef' }, [{ frame: 4, usesHands: true }]), [], 'a head piece never blocks the hands');
  assert.match(wear.wearProblems({ role: 'barista' }, [{ frame: 3 }, { frame: 5, usesHands: true }])[0], /frame 5 uses the hands while the critter still holds the cup/);
  assert.deepEqual(wear.wearProblems({ role: 'barista' }, [{ frame: 4, putsDown: true }, { frame: 5, usesHands: true }]), []);
  assert.match(wear.wearProblems({ head: 'cap', hand: 'cup', bowtie: true })[0], /more than two signifiers/);
  assert.match(wear.wearProblems({ head: 'crown' }).join(';'), /head piece "crown"/);
  assert.match(wear.wearProblems({ hand: 'sword' }).join(';'), /hand prop "sword"/);
  assert.match(wear.wearProblems({ headTone: 'slate' }).join(';'), /a head colour with no head piece/);
  assert.deepEqual(wear.wear({ role: 'mail carrier' }), { role: 'mail carrier', head: 'cap', hand: 'envelope', bowtie: false, headTone: 'slate' });
});

test('the reference states and moods still draw in the tile (sheets): hooks, poses, no NaN', async () => {
  const { cast } = await kit();
  const idle = cast.D.tile({ state: 'idle' });
  assert.match(idle, /<g class="bob">/);
  assert.equal((idle.match(/class="blink"/g) ?? []).length, 2);
  assert.match(cast.D.tile({ state: 'wait' }), /class="wave"/);
  assert.doesNotMatch(cast.D.tile({}), /class=/, 'a still critter has no hooks');
  for (const pose of Object.keys(cast.D.ARM_POSES)) assert.doesNotMatch(cast.D.tile({ arms: pose }), /undefined|NaN/);
  assert.match(cast.D.tile({ mood: 'confident' }), /rotate\(-3 100 110\)/, 'main\'s confident draws as D\'s proud');
});
