import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type Anthropic from '@anthropic-ai/sdk';

import { bankObject, findBanked, loadObjects, slugOf } from '@/lib/real-case/objects/bank';
import { caseFileObjects, objectNeeds, prepareObjects, type Scene } from '@/lib/real-case/objects/prepare';
import { parsePick, pickCandidate, pickRequest } from '@/lib/real-case/objects/pick';
import { stockCandidates, type StockSearch } from '@/lib/real-case/objects/stock';
import { traceDrawing } from '@/lib/real-case/objects/trace';
import type { ImageUsage } from '@/lib/reels/visual/image';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rc-obj-test-'));
const png = (w = 64, h = 64) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
const usage = { input_tokens: 900, output_tokens: 3, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 } as Anthropic.Message['usage'];
const reply = (text: string) => ({ content: [{ type: 'text', text }], usage }) as unknown as Anthropic.Message;
const noUsd = { usd: 0.04 } as unknown as ImageUsage;

const PLAN = `# Plan\n\n## Case file\n\n- when: today\n- objects:\n  - smartphone — acts 1, 3, 5\n  - padlock — act 3\n  - paper map — act 7\n- mechanism: a → b\n\n## Frame 1\n`;

test('case file objects parse with their acts', () => {
  assert.deepEqual(caseFileObjects(PLAN), [
    { name: 'smartphone', acts: [1, 3, 5] },
    { name: 'padlock', acts: [3] },
    { name: 'paper map', acts: [7] },
  ]);
  assert.deepEqual(caseFileObjects('# no case file'), []);
});

test('objects need a cutout for board/newspaper and a drawing for whiteboard', () => {
  const grounds: Record<number, Scene> = { 1: 'board', 3: 'whiteboard', 5: 'newspaper' };
  const needs = objectNeeds(caseFileObjects(PLAN), (n) => grounds[n] ?? null);
  assert.deepEqual(needs, [
    { name: 'smartphone', slug: 'smartphone', kinds: ['cutout', 'drawing'] },
    { name: 'padlock', slug: 'padlock', kinds: ['drawing'] },
  ]);
});

test('the pick request caches the stable system and keeps the image in the suffix', () => {
  const req = pickRequest('padlock', Buffer.from('x'), 3);
  const system = req.system as Anthropic.TextBlockParam[];
  assert.ok(system.at(-1)?.cache_control, 'system prefix carries cache_control');
  assert.ok(!JSON.stringify(system).includes('padlock'), 'the object is not in the cached prefix');
  assert.ok(JSON.stringify(req.messages).includes('padlock'));
  assert.equal(parsePick('PICK 2', 3), 1);
  assert.equal(parsePick('NONE', 3), null);
  assert.equal(parsePick('PICK 9', 3), null);
});

test('pickCandidate returns the stubbed pick and NONE as null', async () => {
  const pngs = [await png(), await png()];
  assert.equal((await pickCandidate('padlock', pngs, async () => reply('PICK 2'))).index, 1);
  assert.equal((await pickCandidate('padlock', pngs, async () => reply('NONE'))).index, null);
});

test('stock keeps only cc0/pdm/by, StockSnap lane first', async () => {
  const c = (url: string, license: string) => ({ url, foreignLandingUrl: `${url}/page`, license, title: 't', creator: 'c', source: 'stocksnap', provider: 'stocksnap' });
  const search: StockSearch = async (_q, { sources }) => (sources ? [c('a', 'cc0'), c('b', 'by-sa')] : [c('a', 'cc0'), c('d', 'BY')]) as never;
  const got = await stockCandidates('padlock', search);
  assert.deepEqual(got.map((g) => [g.url, g.license]), [['a', 'cc0'], ['d', 'by']]);
});

test('the bank only serves approved entries by exact slug', async () => {
  const root = tmp();
  const file = path.join(root, 'in.png');
  fs.writeFileSync(file, await png());
  const base = { kind: 'cutout' as const, width: 64, height: 64, credit: 'c', license: 'cc0', source: 's' };
  bankObject({ ...base, slug: 'padlock', name: 'padlock', approved: true }, { png: file }, root);
  bankObject({ ...base, slug: 'jane-doe', name: 'Jane Doe', kind: 'person-sketch', approved: false }, { png: file }, root);
  assert.equal(loadObjects(root).length, 2);
  assert.ok(findBanked('padlock', 'cutout', root));
  assert.equal(findBanked('padlock', 'drawing', root), null);
  assert.equal(findBanked('padlocks', 'cutout', root), null);
  assert.equal(findBanked('jane-doe', 'person-sketch', root), null, 'unapproved sketch is not served');
  assert.equal(slugOf('Paper Map!'), 'paper-map');
});

const hasAutotrace = (() => {
  try {
    execFileSync('autotrace', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return fs.existsSync('/opt/homebrew/bin/autotrace');
  }
})();

test('trace turns a line drawing into ordered centerline strokes', { skip: !hasAutotrace && 'autotrace not installed' }, async () => {
  const dir = tmp();
  const src = path.join(dir, 'd.png');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><circle cx="200" cy="200" r="120" fill="none" stroke="black" stroke-width="8"/><line x1="60" y1="360" x2="340" y2="360" stroke="black" stroke-width="8"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(src);
  const t = await traceDrawing(src);
  assert.ok(t.strokes.length >= 2, `got ${t.strokes.length} strokes`);
  assert.ok(t.strokes.every((d) => d.startsWith('M')));
});

test('prepare: bank hit, picked cutout, drawing, NONE falls back to a photo, sketch held for approval', async () => {
  const root = tmp();
  const proj = tmp();
  const seed = path.join(root, 'seed.png');
  fs.writeFileSync(seed, await png());
  bankObject({ slug: 'padlock', kind: 'cutout', name: 'padlock', width: 64, height: 64, credit: 'c', license: 'cc0', source: 's', approved: true }, { png: seed }, root);
  fs.writeFileSync(path.join(root, 'person.png'), await png());

  const search: StockSearch = async () => [{ url: 'u1', foreignLandingUrl: 'p1', license: 'cc0', title: 't', creator: 'c' }] as never;
  const http = (async () => new Response(new Uint8Array(await png()))) as unknown as typeof fetch;
  const removeBg = async (_src: string, out: string) => {
    fs.writeFileSync(out, await png());
    return { ok: true as const, width: 64, height: 64, coverage: 0.5 };
  };
  const stroke = { width: 100, height: 100, strokes: ['M0 0L50 50', 'M10 0L10 90', 'M0 10L90 10'] };
  let calls = 0;
  const create = async () => reply(calls++ === 0 ? 'PICK 1' : 'NONE');

  const r = await prepareObjects(
    proj,
    [
      { name: 'padlock', slug: 'padlock', kinds: ['cutout'] },
      { name: 'smartphone', slug: 'smartphone', kinds: ['cutout', 'drawing'] },
      { name: 'paper map', slug: 'paper-map', kinds: ['cutout'] },
    ],
    [{ name: 'Jane Doe', cutout: 'person.png' }],
    { root, create, search, http, removeBg, generate: async () => ({ png: await png(), usage: noUsd }), trace: async () => stroke },
  );

  const files = r.placed.map((p) => p.file).sort();
  assert.deepEqual(files, ['assets/objects/cutout/padlock.png', 'assets/objects/cutout/paper-map.png', 'assets/objects/cutout/smartphone.png', 'assets/objects/drawing/smartphone.png']);
  assert.equal(findBanked('paper-map', 'cutout', root)?.source, 'gpt-image-2');
  assert.ok(fs.existsSync(path.join(proj, 'assets/objects/drawing/smartphone.strokes.json')));
  assert.ok(r.flags.some((f) => f.includes('Jane Doe') && f.includes('approval')));
  assert.equal(findBanked('jane-doe', 'person-sketch', root), null);
  assert.ok(findBanked('smartphone', 'drawing', root));
  assert.equal(JSON.parse(fs.readFileSync(path.join(proj, 'assets/objects/credits.json'), 'utf8')).length, 4);
  assert.ok(Math.abs(r.usd.drawing - 0.12) < 1e-9);
  assert.ok(r.usd.vision > 0);
});

test('without a vision check a cutout comes from a generated photo, not stock', async () => {
  const root = tmp();
  let searched = false;
  const removeBg = async (_src: string, out: string) => {
    fs.writeFileSync(out, await png());
    return { ok: true as const, width: 64, height: 64, coverage: 0.5 };
  };
  const r = await prepareObjects(tmp(), [{ name: 'padlock', slug: 'padlock', kinds: ['cutout'] }], [], {
    root, create: null, removeBg, search: async () => { searched = true; return []; },
    generate: async () => ({ png: await png(), usage: noUsd }),
  });
  assert.equal(searched, false);
  assert.equal(r.placed.length, 1);
  assert.equal(r.flags.length, 0);
});

test('a photo that will not cut out is a flag, never a wrong object', async () => {
  const r = await prepareObjects(tmp(), [{ name: 'padlock', slug: 'padlock', kinds: ['cutout'] }], [], {
    root: tmp(), create: null, removeBg: async () => ({ ok: false as const, error: 'too small' }),
    generate: async () => ({ png: await png(), usage: noUsd }),
  });
  assert.equal(r.placed.length, 0);
  assert.match(r.flags[0]!, /did not cut out/);
});
