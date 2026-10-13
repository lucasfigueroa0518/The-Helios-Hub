/**
 * Cover images do not repeat (Tommy, 2026-10-12). Every Anthropic story opened
 * with the same logo because logos were exempt from the 7-day rule and a
 * company had one logo. Now a company has a pool of logos (its own marks, its
 * icon, its products' marks), a logo used as a cover cannot repeat within 7
 * days, covers take the least recently used, and a cover whose logos are all
 * spent tries the company's other looks (CEO, headquarters, official images)
 * before the Writer's fallback. Offline: fake web, no model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { companyRung } from '@/lib/social/photos/design';
import { newSearchContext, searchVisual } from '@/lib/social/photos/find';
import type { IdentityResult } from '@/lib/social/photos/identity';
import { MAX_PRODUCT_LOGOS, fetchLogos } from '@/lib/social/photos/logo';
import type { Brief } from '@/lib/social/reporter/brief';
import type { VisualRequest } from '@/lib/social/writer/draft';

type FileSpec = { licence?: string; w?: number; h?: number };
type Web = { claims: Record<string, unknown[]>; products?: Record<string, { label?: string; labels?: Record<string, { value: string }>; claims: Record<string, unknown[]> }>; files: Record<string, FileSpec> };

const val = (value: unknown, extra: Record<string, unknown> = {}) => ({ rank: 'normal', mainsnak: { datavalue: { value } }, ...extra });
const ended = { qualifiers: { P582: [{ datavalue: { value: { time: '+2020' } } }] } };
const thumb = (file: string) => `https://upload.wikimedia.org/thumb/${encodeURIComponent(file)}.png`;

/** Fake Wikidata (the company Q1 and its products), Commons imageinfo by file, and the PNGs. */
async function fakeWeb(web: Web): Promise<typeof fetch> {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 400, height: 160, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 1 } } }).png().toBuffer();
  return (async (url: string) => {
    const u = new URL(String(url));
    if (u.hostname.includes('wikidata.org')) {
      const ids = (u.searchParams.get('ids') ?? '').split('|');
      const entities: Record<string, unknown> = {};
      for (const id of ids) {
        if (id === 'Q1') entities.Q1 = { claims: web.claims };
        else if (web.products?.[id]) entities[id] = { claims: web.products[id]!.claims, labels: web.products[id]!.labels ?? (web.products[id]!.label ? { en: { value: web.products[id]!.label! } } : {}) };
      }
      return new Response(JSON.stringify({ entities }));
    }
    if (u.hostname.includes('commons.wikimedia.org')) {
      const title = (u.searchParams.get('titles') ?? '').replace(/^File:/, '');
      const spec = web.files[title];
      if (!spec) return new Response(JSON.stringify({ query: { pages: { '-1': { title, missing: '' } } } }));
      return new Response(JSON.stringify({ query: { pages: { 1: { title, imageinfo: [{ thumburl: thumb(title), thumbwidth: spec.w ?? 800, thumbheight: spec.h ?? 200, extmetadata: { LicenseShortName: { value: spec.licence ?? 'Public domain' } } }] } } } }));
    }
    if (u.hostname.includes('upload.wikimedia.org')) return new Response(new Uint8Array(png));
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

const ACME: Web = {
  claims: {
    P154: [val('Acme logo.svg'), val('Acme old logo.svg', ended), val('Acme bad.svg', { rank: 'deprecated' })],
    P2910: [val('Acme icon.svg')],
    P1056: [val({ id: 'Q10' }), val({ id: 'Q11' })],
  },
  products: {
    Q10: { label: 'Acme Chat', claims: { P154: [val('Acme Chat logo.svg')] } },
    Q11: { label: 'Acme Paper', claims: {} },
  },
  files: { 'Acme logo.svg': {}, 'Acme icon.svg': { w: 512, h: 512 }, 'Acme Chat logo.svg': { w: 690, h: 148 } },
};

test('fetchLogos: the company’s own logos, its icon, then its products’ logos; ended and deprecated marks never', async () => {
  const r = await fetchLogos('Q1', 'Acme', { http: await fakeWeb(ACME) });
  assert.deepEqual(r.logos.map((l) => l.file), ['Acme logo.svg', 'Acme icon.svg', 'Acme Chat logo.svg']);
  assert.deepEqual(r.logos.map((l) => l.photo.credit), [
    'Logo: Acme (public domain) · Wikimedia Commons',
    'Logo: Acme (public domain) · Wikimedia Commons',
    'Logo: Acme Chat (public domain) · Wikimedia Commons',
  ]);
  // Found through the verified company, so the bank and the repeat rule treat every mark as the company's.
  for (const l of r.logos) assert.deepEqual([l.photo.qid, l.photo.subject, l.photo.source], ['Q1', 'Acme', 'logo']);
  assert.ok(r.logos.every((l) => l.photo.plate === 'dark' || l.photo.plate === 'light'));
});

test('fetchLogos: the same checks as the single logo (licence, shape); a failing one is skipped with a reason, the rest stay', async () => {
  const web: Web = { ...ACME, files: { ...ACME.files, 'Acme icon.svg': { licence: 'Fair use' }, 'Acme Chat logo.svg': { w: 2000, h: 100 } } };
  const r = await fetchLogos('Q1', 'Acme', { http: await fakeWeb(web) });
  assert.deepEqual(r.logos.map((l) => l.file), ['Acme logo.svg']);
  assert.equal(r.reasons.length, 2);
  assert.match(r.reasons.join(' | '), /licence not allowed/);
  assert.match(r.reasons.join(' | '), /too wide/);
});

test('fetchLogos: the same file twice counts once, and at most MAX_PRODUCT_LOGOS products add a mark', async () => {
  assert.equal(MAX_PRODUCT_LOGOS, 4);
  const products: NonNullable<Web['products']> = {};
  const files: Web['files'] = { 'Acme logo.svg': {} };
  const p1056: unknown[] = [];
  for (let i = 0; i < 7; i++) {
    products[`Q2${i}`] = { label: `Product ${i}`, claims: { P154: [val(`Product ${i}.svg`)] } };
    files[`Product ${i}.svg`] = {};
    p1056.push(val({ id: `Q2${i}` }));
  }
  const web: Web = { claims: { P154: [val('Acme logo.svg'), val('Acme logo.svg')], P1056: p1056 }, products, files };
  const r = await fetchLogos('Q1', 'Acme', { http: await fakeWeb(web) });
  assert.equal(r.logos.filter((l) => l.file === 'Acme logo.svg').length, 1);
  assert.equal(r.logos.filter((l) => l.file.startsWith('Product')).length, MAX_PRODUCT_LOGOS);
});

test('fetchLogos: a product whose name Wikidata keeps only as a multilingual label is still named, and one with no name is credited to the company, never to an ID', async () => {
  const web: Web = {
    claims: { P154: [val('Acme logo.svg')], P1056: [val({ id: 'Q30' }), val({ id: 'Q31' })] },
    products: {
      Q30: { labels: { mul: { value: 'Acme Office' } }, claims: { P154: [val('Acme Office.svg')] } },
      Q31: { claims: { P154: [val('Unnamed.svg')] } },
    },
    files: { 'Acme logo.svg': {}, 'Acme Office.svg': {}, 'Unnamed.svg': {} },
  };
  const r = await fetchLogos('Q1', 'Acme', { http: await fakeWeb(web) });
  assert.deepEqual(r.logos.map((l) => l.photo.credit), [
    'Logo: Acme (public domain) · Wikimedia Commons',
    'Logo: Acme Office (public domain) · Wikimedia Commons',
    'Logo: Acme (public domain) · Wikimedia Commons',
  ]);
  assert.ok(r.logos.every((l) => !/\bQ\d+\b/.test(l.photo.credit)), 'no Wikidata id ever reaches a credit');
});

test('fetchLogos: a product that no longer exists (a dissolved company Wikidata lists as a product) adds no mark', async () => {
  const web: Web = {
    claims: { P154: [val('Acme logo.svg')], P1056: [val({ id: 'Q40' }), val({ id: 'Q41' })] },
    products: {
      Q40: { label: 'Old Acquisition', claims: { P154: [val('Old.svg')], P576: [val({ time: '+2012' })] } },
      Q41: { label: 'Acme Chat', claims: { P154: [val('Acme Chat logo.svg')] } },
    },
    files: { 'Acme logo.svg': {}, 'Old.svg': {}, 'Acme Chat logo.svg': {} },
  };
  const r = await fetchLogos('Q1', 'Acme', { http: await fakeWeb(web) });
  assert.deepEqual(r.logos.map((l) => l.file), ['Acme logo.svg', 'Acme Chat logo.svg']);
});

test('fetchLogos: a company with no logo data has none, with a reason', async () => {
  const r = await fetchLogos('Q1', 'Acme', { http: await fakeWeb({ claims: {}, files: {} }) });
  assert.deepEqual(r.logos, []);
  assert.match(r.reasons[0]!, /no logo/i);
});

// ── The finder: covers, repeats and rotation ────────────────────────────────

function briefWithAcme(): Brief {
  const b = briefSuperIntelligenceForce();
  b.subjects = [...b.subjects, { id: 'S9', type: 'organization', name: 'Acme', role: 'AI company' }];
  return b;
}
const verified = [['Acme', Promise.resolve({ ok: true, scores: { person: 0, matches: [] }, qid: 'Q1', label: 'Acme', description: '', type: 'organization', via: 'resolver' } as IdentityResult)]] as Array<[string, Promise<IdentityResult>]>;
const noJev = (async () => { throw new Error('no Jev in this test'); }) as never;
const LOGO: VisualRequest = { kind: 'logo', query: 'Acme' };

async function findLogos(opts: { cover: boolean; recent?: string[]; lastUsed?: Record<string, string> }) {
  const http = await fakeWeb(ACME);
  const ctx = newSearchContext(briefWithAcme(), [], { identities: new Map(verified), recent: new Set(opts.recent ?? []), lastUsed: new Map(Object.entries(opts.lastUsed ?? {})), photos: [] });
  return searchVisual(LOGO, ctx, { jev: noJev, http }, { cover: opts.cover, tags: ['S9'] });
}
const files = (t: { candidates: Array<{ url: string }> }) => t.candidates.map((c) => decodeURIComponent(c.url.split('/').pop()!.replace('.png', '')));

test('a cover never repeats a logo used in the last 7 days; it takes one of the company’s other marks', async () => {
  const t = await findLogos({ cover: true, recent: [thumb('Acme logo.svg')] });
  assert.ok(!files(t).includes('Acme logo.svg'));
  assert.ok(files(t).length > 0, 'another mark of the same company is offered');
});

test('when every mark was a cover in the last 7 days, the cover finds no logo (the rotation moves on)', async () => {
  const all = ['Acme logo.svg', 'Acme icon.svg', 'Acme Chat logo.svg'].map(thumb);
  const t = await findLogos({ cover: true, recent: all });
  assert.deepEqual(t.candidates, []);
});

test('a logo on a story slide keeps its exemption', async () => {
  const t = await findLogos({ cover: false, recent: [thumb('Acme logo.svg')] });
  assert.ok(files(t).includes('Acme logo.svg'));
});

test('covers take the least recently used mark first, never-used before any used', async () => {
  const t = await findLogos({
    cover: true,
    lastUsed: { [thumb('Acme logo.svg')]: '2026-09-20T00:00:00Z', [thumb('Acme icon.svg')]: '2026-09-01T00:00:00Z' }, // both older than 7 days; Acme Chat never
  });
  // The finder keeps its usual couple of candidates, in rotation order.
  assert.deepEqual(files(t).slice(0, 2), ['Acme Chat logo.svg', 'Acme icon.svg']);
});

// ── The cover step ──────────────────────────────────────────────────────────

test('companyRung: a cover whose logo request found nothing tries the same company’s other looks', () => {
  assert.deepEqual(companyRung({ kind: 'logo', query: 'Acme' }, { candidates: [] }), { kind: 'company', query: 'Acme' });
});

test('companyRung: not when the logo found something, and not for any other kind of request', () => {
  assert.equal(companyRung({ kind: 'logo', query: 'Acme' }, { candidates: [{ url: 'x' } as never] }), null);
  for (const kind of ['person', 'company', 'product', 'event', 'thematic', 'setting'] as const) assert.equal(companyRung({ kind, query: 'Acme' }, { candidates: [] }), null, kind);
});

// ── The photo bank keeps every variant ──────────────────────────────────────

test('the photo bank stores each logo variant, a product’s mark credited to the product included', async () => {
  const { planOffer } = await import('@/lib/media-library/bank');
  const r = await fetchLogos('Q1', 'Acme', { http: await fakeWeb(ACME) });
  const items = r.logos.map((l) => ({
    slide: 1,
    request: { kind: 'logo', query: 'Acme' } as VisualRequest,
    outcome: 'verified' as const,
    candidate: { ...l.photo, lane: 'logo' as const, date: null, title: l.file, verified: true },
    tileTags: null,
    fit: null,
    vision: null,
  }));
  const rows = planOffer({ runKind: 'backfill', runRef: 'logo-variants-test', subjects: ['Acme'], items });
  assert.equal(rows.sources.length, r.logos.length, 'every variant is queued for the bank');
  assert.deepEqual(rows.sources.map((s) => s.licence), ['open', 'open', 'open']);
  assert.ok(rows.sightings.every((s) => s.qid === 'Q1' && s.verified), 'each is a verified sighting of the company');
});
