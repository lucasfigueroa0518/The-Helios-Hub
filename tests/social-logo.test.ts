/**
 * Helios Social: covers in Photo chain v1 (spec §5.1, 2026-10-07): logo cards
 * for identity-verified organizations (Commons licence check only, no
 * per-company permission), the cover order, the branded cover card, and the
 * logo-card render. Offline: fake web, stub Jev.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { sifDraftHandoff } from '@/fixtures/social/drafts';
import { findPhoto, newPhotoContext, type Photo } from '@/lib/social/photos/find';
import type { IdentityResult } from '@/lib/social/photos/identity';
import { LOGO_MAX_ASPECT, currentLogoFile, fetchLogo, plateFor } from '@/lib/social/photos/logo';
import { DEFAULT_TOPIC, STARTER_SET } from '@/lib/social/photos/starter-set';
import { toRenderPost } from '@/lib/social/render/from-draft';
import type { Brief } from '@/lib/social/reporter/brief';
import { fillDraft } from '@/lib/social/writer/draft';

function briefWith(...subjects: Array<{ name: string; role: string }>): Brief {
  const b = briefSuperIntelligenceForce();
  b.subjects = [...b.subjects, ...subjects.map((s, i) => ({ id: `S${9 + i}`, ...s }))];
  return b;
}

/** Identity already verified (no Jev / resolver in these tests). */
const verified = (name: string, qid: string, type: 'organization' | 'person'): [string, Promise<IdentityResult>] => [name, Promise.resolve({ ok: true, scores: { person: 0, matches: [] }, qid, label: name, description: '', type, via: 'resolver' })];
const noJev = (async () => { throw new Error('no Jev in this test'); }) as never;

/** Fake web: Wikidata (no P18; a P154 logo), Commons imageinfo with a rendered PNG, the PNG itself. */
async function fakeLogoWeb(opts: { licence?: string; dark?: boolean; claims?: unknown[]; p18?: string } = {}): Promise<typeof fetch> {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 400, height: 160, channels: 4, background: opts.dark ? { r: 20, g: 20, b: 20, alpha: 1 } : { r: 240, g: 240, b: 240, alpha: 1 } } }).png().toBuffer();
  const claims = opts.claims ?? [{ rank: 'normal', mainsnak: { datavalue: { value: 'Acme logo.svg' } } }];
  return (async (url: string) => {
    const u = String(url);
    if (u.includes('wikidata.org')) {
      const p18 = opts.p18 ? { P18: [{ mainsnak: { datavalue: { value: opts.p18 } } }] } : {};
      return new Response(JSON.stringify({ entities: { Q1: { claims: { P154: claims, ...p18 } }, Q2: { claims: { ...p18 } } } }));
    }
    if (u.includes('commons.wikimedia.org/w/api.php')) {
      const title = new URL(u).searchParams.get('titles') ?? '';
      if (title.includes('portrait')) return new Response(JSON.stringify({ query: { pages: { 1: { title, imageinfo: [{ url: 'https://upload.wikimedia.org/portrait.jpg', width: 1600, height: 2000, mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC BY 2.0' }, Artist: { value: 'A Photographer' } } }] } } } }));
      return new Response(JSON.stringify({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb/acme-logo.png', thumbwidth: 800, thumbheight: 320, extmetadata: { LicenseShortName: { value: opts.licence ?? 'Public domain' } } }] } } } }));
    }
    if (u.includes('upload.wikimedia.org')) return new Response(new Uint8Array(png));
    throw new Error(`unexpected fetch ${u}`);
  }) as unknown as typeof fetch;
}

const cover = (text: string) => ({ text: [text], speaker: null, slot: 'split' as const, cover: true });
const isAiComputeStarter = (url: string) => STARTER_SET.find((p) => url.endsWith(p.file))?.topics.includes(DEFAULT_TOPIC) ?? false;

test('logo: the current P154 value (preferred rank, else no end date, latest start)', () => {
  const v = (value: string, extra: Record<string, unknown> = {}) => ({ rank: 'normal' as const, mainsnak: { datavalue: { value } }, ...extra });
  assert.equal(currentLogoFile([v('old.svg', { qualifiers: { P582: [{ datavalue: { value: { time: '+2015' } } }] } }), v('new.svg')]), 'new.svg');
  assert.equal(currentLogoFile([v('a.svg'), v('b.svg', { rank: 'preferred' })]), 'b.svg');
  assert.equal(currentLogoFile([v('2010.svg', { qualifiers: { P580: [{ datavalue: { value: { time: '+2010' } } }] } }), v('2020.svg', { qualifiers: { P580: [{ datavalue: { value: { time: '+2020' } } }] } })]), '2020.svg');
  assert.equal(currentLogoFile([v('x.svg', { rank: 'deprecated' })]), null);
});

test('logo: the Commons licence check decides (no per-company permission); a dark logo gets a light plate, a light logo a dark plate; up to 10:1', async () => {
  const sharp = (await import('sharp')).default;
  const dark = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } } }).png().toBuffer();
  assert.equal(await plateFor(dark), 'light');
  const r = await fetchLogo('Q1', 'Acme', { http: await fakeLogoWeb() });
  assert.ok(r.photo);
  assert.equal(r.photo.plate, 'dark');
  assert.equal(r.photo.credit, 'Logo: Acme (public domain) · Wikimedia Commons');
  assert.equal((await fetchLogo('Q1', 'Acme', { http: await fakeLogoWeb({ licence: 'Fair use' }) })).photo, null, 'a non-free logo never');
  assert.equal(LOGO_MAX_ASPECT, 10);
});

test('cover, organization subject: its logo card (any verified organization; brand-guideline preferences do not block it), not its P18', async () => {
  const b = briefWith({ name: 'Anthropic', role: 'AI company' });
  const c = newPhotoContext(b, []);
  c.identities = new Map([verified('Anthropic', 'Q1', 'organization')]);
  const t = await findPhoto({ kind: 'subject', value: 'Anthropic' }, c, { jev: noJev, http: await fakeLogoWeb({ p18: 'Anthropic office portrait.jpg' }) }, cover('Anthropic merges two security programs'));
  assert.equal(t.via, 'logo');
  assert.ok(t.steps.some((s) => /is an organization \(its P18 is not used on a cover/.test(s)), t.steps.join(' | '));
});

test("cover, person subject: the person's P18 first; then the logo card of the organization named in the cover; never a person's logo", async () => {
  const b = briefWith({ name: 'Jane Doe', role: 'CEO of Acme' }, { name: 'Acme', role: 'company' });
  const withP18 = newPhotoContext(b, []);
  withP18.identities = new Map([verified('Jane Doe', 'Q2', 'person'), verified('Acme', 'Q1', 'organization')]);
  const p = await findPhoto({ kind: 'subject', value: 'Jane Doe' }, withP18, { jev: noJev, http: await fakeLogoWeb({ p18: 'Jane Doe portrait.jpg' }) }, cover('Jane Doe leaves Acme'));
  assert.equal(p.via, 'subject');
  const noP18 = newPhotoContext(b, []);
  noP18.identities = new Map([verified('Jane Doe', 'Q2', 'person'), verified('Acme', 'Q1', 'organization')]);
  const l = await findPhoto({ kind: 'subject', value: 'Jane Doe' }, noP18, { jev: noJev, http: await fakeLogoWeb() }, cover('Jane Doe leaves Acme'));
  assert.equal(l.via, 'logo');
  assert.equal((l.photo as Photo).qid, 'Q1');
  assert.ok(l.steps.some((s) => /logo card: Jane Doe is a person, not an organization/.test(s)));
});

test('cover order: logo card before stock; nothing → the AI-compute starter, or the branded cover card once approved', async () => {
  const b = briefWith({ name: 'Acme', role: 'company' });
  const stockCalls: string[] = [];
  const stock = async (q: string) => { stockCalls.push(q); return []; };
  const c1 = newPhotoContext(b, []);
  c1.identities = new Map([verified('Acme', 'Q1', 'organization')]);
  const l = await findPhoto({ kind: 'stock', value: 'office laptop' }, c1, { jev: noJev, http: await fakeLogoWeb(), stock }, cover('Acme ships a new model'));
  assert.equal(l.via, 'logo');
  assert.deepEqual(stockCalls, [], 'stock is not reached');
  // Logos are exempt from the 7-day rule across posts: used last week (or earlier in this run) → still the logo card.
  const week = newPhotoContext(b, [], { recent: new Set(['https://upload.wikimedia.org/thumb/acme-logo.png']) });
  week.identities = new Map([verified('Acme', 'Q1', 'organization')]);
  assert.equal((await findPhoto({ kind: 'stock', value: 'office laptop' }, week, { jev: noJev, http: await fakeLogoWeb(), stock }, cover('Acme ships a new model'))).via, 'logo');
  // The logo already used in THIS post → stock (nothing) → starter, or the cover card when approved.
  const c2 = newPhotoContext(b, []);
  c2.used.add('https://upload.wikimedia.org/thumb/acme-logo.png');
  c2.identities = new Map([verified('Acme', 'Q1', 'organization')]);
  const s = await findPhoto({ kind: 'stock', value: 'office laptop' }, c2, { jev: noJev, http: await fakeLogoWeb(), stock }, cover('Acme ships a new model'));
  assert.equal(s.via, 'starter');
  assert.ok(isAiComputeStarter(s.photo!.url));
  const c3 = newPhotoContext(b, []);
  c3.used.add('https://upload.wikimedia.org/thumb/acme-logo.png');
  c3.identities = new Map([verified('Acme', 'Q1', 'organization')]);
  const card = await findPhoto({ kind: 'stock', value: 'office laptop' }, c3, { jev: noJev, http: await fakeLogoWeb(), stock, designed: { statBackgrounds: false, coverCard: true } }, cover('Acme ships a new model'));
  assert.equal(card.via, 'cover-card');
  assert.equal(card.photo, null);
});

test('render: a logo card (Helios canvas, no pattern; plate; wide logos sized by width) and the branded cover card (the sun-mark, headline below)', async () => {
  const d = fillDraft(sifDraftHandoff(), briefSuperIntelligenceForce());
  const logo = (w: number, h: number): Photo => ({ url: `https://upload.wikimedia.org/${w}x${h}.png`, credit: 'Logo: Acme (public domain) · Wikimedia Commons', source: 'logo', width: w, height: h, qid: 'Q1', subject: 'Acme', plate: 'dark' });
  const meta = { source: 'x', sourceUrl: '', publishedAt: '2026-10-07T00:00:00Z' };
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SlideTemplate } = await import('@/lib/social/render/SlideTemplate');

  const wide = toRenderPost(d, { cover: logo(800, 90), slides: d.slides.map(() => null) }, meta);
  assert.equal(wide.slides[0]!.logoWide, true);
  const html = renderToStaticMarkup(React.createElement(SlideTemplate, { post: wide, position: 0 }));
  assert.match(html, /helios-cover--logo/);
  assert.match(html, /helios-logo-card__plate--dark/);
  assert.match(html, /helios-logo-card__logo--wide/);
  assert.equal(toRenderPost(d, { cover: logo(800, 800), slides: d.slides.map(() => null) }, meta).slides[0]!.logoWide, undefined);

  const card = toRenderPost(d, { cover: null, slides: d.slides.map(() => null), coverCard: true }, meta);
  assert.equal(card.slides[0]!.coverCard, true);
  const cardHtml = renderToStaticMarkup(React.createElement(SlideTemplate, { post: card, position: 0 }));
  assert.match(cardHtml, /helios-cover--card/);
  assert.match(cardHtml, /helios-cover-card__mark" src="\/social\/helios-mark\.png"/);
  const css = (await import('node:fs')).readFileSync('app/social/render/preview/preview.css', 'utf8');
  assert.ok(!/\.helios-cover--logo \{[^}]*linear-gradient/.test(css), 'no pattern behind the logo card (Helios design system)');
});

test('company cover: a usable article photo (the cover request) comes before the logo card', async () => {
  const b = briefWith({ name: 'Acme', role: 'company' });
  const page = { ok: true as const, url: 'https://news.example/a', resolvedUrl: 'https://news.example/a', title: null, byline: null, publishedTime: null, text: 'x', truncated: false, photos: [{ src: 'https://news.example/acme-launch.jpg', caption: 'The launch. (Courtesy of Acme)', credit: null, alt: null, from: 'figure' as const }] };
  const c = newPhotoContext(b, [page]);
  c.identities = new Map([verified('Acme', 'Q1', 'organization')]);
  const t = await findPhoto({ kind: 'article', value: 'https://news.example/acme-launch.jpg' }, c, { jev: noJev, http: await fakeLogoWeb() }, cover('Acme ships a new model'));
  assert.equal(t.via, 'article');
});
