/**
 * Meme lab M2 (planning/Memes/BUILD_PLAN.md): geometry and resolution, no
 * browser. The Chromium render of every template is checked by
 * scripts/memes_render_samples.ts (fit and faces), which writes the review
 * sheet.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_CATALOG } from '@/lib/memes/catalog';
import { TEMPLATE_FACES } from '@/lib/memes/faces.generated';
import { mockingCase, resolveMeme, type MemeFill } from '@/lib/memes/fill';
import { TEMPLATE_GEOMETRY, overlaps } from '@/lib/memes/geometry';
import { CANVAS_H, CANVAS_W, imageRect, memeHtml } from '@/lib/memes/render';
import { SAMPLE_FILLS } from '@/lib/memes/samples';

test('geometry: every slot of every card has a box inside the image', () => {
  assert.deepEqual(Object.keys(TEMPLATE_GEOMETRY).sort(), TEMPLATE_CATALOG.map((t) => t.id).sort());
  for (const t of TEMPLATE_CATALOG) {
    const g = TEMPLATE_GEOMETRY[t.id]!;
    assert.deepEqual(Object.keys(g.slots).sort(), t.slots.map((x) => x.id).sort(), t.id);
    for (const [id, b] of Object.entries(g.slots)) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, `${t.id}.${id} leaves the image`);
      assert.ok(b.w > 0.05 && b.h > 0.03, `${t.id}.${id} is too small to hold anything`);
    }
  }
});

test('geometry: no box touches a face, detected or hand-marked (ME-12)', () => {
  for (const t of TEMPLATE_CATALOG) {
    const g = TEMPLATE_GEOMETRY[t.id]!;
    const faces = [...(TEMPLATE_FACES[t.id] ?? []), ...(g.faces ?? [])];
    for (const [id, b] of Object.entries(g.slots)) for (const f of faces) assert.ok(!overlaps(b, f), `${t.id}.${id} touches a face`);
  }
});

test('geometry: no two slot boxes overlap', () => {
  for (const t of TEMPLATE_CATALOG) {
    const boxes = Object.entries(TEMPLATE_GEOMETRY[t.id]!.slots);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i]![1], boxes[j]![1]), `${t.id}: ${boxes[i]![0]} overlaps ${boxes[j]![0]}`);
  }
});

test('canvas: a template is fitted whole and centered on the 1080×1350 canvas', () => {
  const square = imageRect(1200, 1200);
  assert.deepEqual([square.w, square.h, square.y], [CANVAS_W, CANVAS_W, (CANVAS_H - CANVAS_W) / 2]);
  const tall = imageRect(298, 403);
  assert.equal(Math.round(tall.h), CANVAS_H);
  assert.ok(tall.w < CANVAS_W);
});

test('resolve: every sample fill resolves, with fixed, repeated and derived slots filled by code', () => {
  assert.equal(SAMPLE_FILLS.length, 60);
  for (const m of SAMPLE_FILLS) resolveMeme(m);
  const gru = resolveMeme(SAMPLE_FILLS.find((m) => m.templateId === 'grus-plan')!);
  const text = (slot: string) => {
    const c = gru.items.find((i) => i.slot === slot)!.content;
    return c.type === 'text' ? c.text : c.name;
  };
  assert.equal(text('flaw-again'), text('flaw'));
  const spongebob = resolveMeme({ templateId: 'mocking-spongebob', fills: [{ slot: 'claim', kind: 'text', text: 'It just works', factIds: ['F1'] }] });
  assert.deepEqual(spongebob.items.map((i) => (i.content.type === 'text' ? i.content.text : '')), ['It just works', mockingCase('It just works')]);
  assert.equal(mockingCase('It just works'), 'iT jUsT wOrKs');
  const odns = resolveMeme({ templateId: 'one-does-not-simply', fills: [{ slot: 'hard-thing', kind: 'text', text: 'export your chats', factIds: [] }] });
  assert.equal(odns.items[0]!.content.type === 'text' && odns.items[0]!.content.text, 'One does not simply');
});

test('resolve: a player renders under its exact registry name with its bank logo (ME-10)', () => {
  const m = resolveMeme({ templateId: 'trade-offer', fills: [
    { slot: 'i-receive', kind: 'text', text: 'a', factIds: [] }, { slot: 'you-receive', kind: 'text', text: 'b', factIds: [] },
    { slot: 'offerer', kind: 'entity', playerId: 'sam-altman' },
  ] });
  const chip = m.items.find((i) => i.slot === 'offerer')!.content;
  assert.equal(chip.type === 'chip' && chip.name, 'Sam Altman');
  assert.match(chip.type === 'chip' ? chip.logo?.file ?? '' : '', /openai\.png$/);
  const ssi = resolveMeme({ templateId: 'trade-offer', fills: [
    { slot: 'i-receive', kind: 'text', text: 'a', factIds: [] }, { slot: 'you-receive', kind: 'text', text: 'b', factIds: [] },
    { slot: 'offerer', kind: 'entity', playerId: 'ilya-sutskever' },
  ] }).items.find((i) => i.slot === 'offerer')!.content;
  assert.deepEqual(ssi, { type: 'chip', name: 'Ilya Sutskever', logo: null, showName: true, logoOptional: true }, 'SSI has no logo: name only');
});

test('chips: a company wordmark stands alone, a symbol carries the name, a person always shows their name', async () => {
  const { bluePlayer } = await import('@/lib/social-hub/blue-chip-players');
  const { chipFor } = await import('@/lib/memes/fill');
  const shows = (id: string) => {
    const c = chipFor(bluePlayer(id)!);
    return c.type === 'chip' ? [c.showName, Boolean(c.logo), c.logoOptional] : null;
  };
  assert.deepEqual(shows('anthropic'), [false, true, false], 'the Anthropic wordmark spells the name');
  assert.deepEqual(shows('apple'), [true, true, false], 'the Apple symbol needs the name');
  assert.deepEqual(shows('xai'), [true, true, false], 'the SpaceXAI mark is a symbol');
  assert.deepEqual(shows('dario-amodei'), [true, true, true], 'a person: name, plus a logo that may drop');
});

test('resolve: refuses an unknown slot, a wrong kind, a missing slot and an unknown player', () => {
  const bad = (m: MemeFill, re: RegExp) => assert.throws(() => resolveMeme(m), re);
  bad({ templateId: 'drake', fills: [{ slot: 'nope', kind: 'text', text: 'x', factIds: [] }] }, /no writable slot "nope"/);
  bad({ templateId: 'uno-draw-25', fills: [{ slot: 'obvious-thing', kind: 'entity', playerId: 'openai' }, { slot: 'refuser', kind: 'viewer', situationId: 'AS-02', text: 'Me' }] }, /takes text, not entity/);
  bad({ templateId: 'drake', fills: [{ slot: 'rejected', kind: 'text', text: 'x', factIds: [] }] }, /drake\.preferred is empty/);
  bad({ templateId: 'trade-offer', fills: [{ slot: 'i-receive', kind: 'text', text: 'a', factIds: [] }, { slot: 'you-receive', kind: 'text', text: 'b', factIds: [] }, { slot: 'offerer', kind: 'entity', playerId: 'not-a-player' }] }, /unknown player/);
});

test('html: text is escaped and every slot is drawn', () => {
  const html = memeHtml(resolveMeme({ templateId: 'marked-safe-from', fills: [{ slot: 'dodged', kind: 'text', text: '<b>limits</b> & ads', factIds: [] }] }));
  assert.match(html, /&lt;b&gt;limits&lt;\/b&gt; &amp; ads/);
  assert.equal((html.match(/class="slot"/g) ?? []).length, 1);
});
