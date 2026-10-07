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
import { newSearchContext, searchVisual, type Photo } from '@/lib/social/photos/find';
import type { IdentityResult } from '@/lib/social/photos/identity';
import { LOGO_MAX_ASPECT, currentLogoFile, fetchLogo, plateFor } from '@/lib/social/photos/logo';
import { toRenderPost } from '@/lib/social/render/from-draft';
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import { fillDraft, type VisualRequest } from '@/lib/social/writer/draft';
import { articlePhotosFor } from '@/lib/social/photos/article-list';

function briefWith(...subjects: Array<{ name: string; role: string; type?: 'person' | 'organization' }>): Brief {
  const b = briefSuperIntelligenceForce();
  b.subjects = [...b.subjects, ...subjects.map((s, i) => ({ id: `S${9 + i}`, type: 'organization' as const, ...s }))];
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

/** A cover slide, tagged with the given SUBJECTS IDs (photo spec §3 rule 3; briefWith adds S9, S10, …). */

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

const search = (b: Brief, request: VisualRequest, http: typeof fetch, ids: Array<[string, Promise<IdentityResult>]>, opts: { recent?: Set<string>; pages?: PageReadOk[] } = {}) =>
  searchVisual(request, newSearchContext(b, opts.pages ?? [], { identities: new Map(ids), recent: opts.recent, photos: opts.pages ? articlePhotosFor(b, opts.pages) : [] }), { jev: noJev, http }, { cover: true, tags: ['S9', 'S10'] });

test('logo: a verified organization\'s logo card (brand-guideline preferences do not block it); its main photo is never a logo', async () => {
  const b = briefWith({ name: 'Anthropic', role: 'AI company' });
  const t = await search(b, { kind: 'logo', query: 'Anthropic' }, await fakeLogoWeb({ p18: 'Anthropic office portrait.jpg' }), [verified('Anthropic', 'Q1', 'organization')]);
  assert.deepEqual(t.candidates.map((c) => [c.lane, c.source]), [['logo', 'logo']]);
});

test("person: the person's P18; a logo request for a person finds nothing (never a person's logo)", async () => {
  const b = briefWith({ name: 'Jane Doe', role: 'CEO of Acme', type: 'person' }, { name: 'Acme', role: 'company' });
  const ids = [verified('Jane Doe', 'Q2', 'person'), verified('Acme', 'Q1', 'organization')];
  const p = await search(b, { kind: 'person', query: 'Jane Doe' }, await fakeLogoWeb({ p18: 'Jane Doe portrait.jpg' }), ids);
  assert.equal(p.candidates[0]?.lane, 'headshot');
  const l = await search(b, { kind: 'logo', query: 'Jane Doe' }, await fakeLogoWeb(), ids);
  assert.deepEqual(l.candidates, []);
  const acme = await search(b, { kind: 'logo', query: 'Acme' }, await fakeLogoWeb(), ids);
  assert.equal(acme.candidates[0]?.qid, 'Q1', "Acme's logo, never one for Jane Doe");
});

test('logos skip the 7-day rule, on covers too', async () => {
  const b = briefWith({ name: 'Acme', role: 'company' });
  const t = await search(b, { kind: 'logo', query: 'Acme' }, await fakeLogoWeb(), [verified('Acme', 'Q1', 'organization')], { recent: new Set(['https://upload.wikimedia.org/thumb/acme-logo.png']) });
  assert.equal(t.candidates[0]?.lane, 'logo');
});

test('render: a logo card (Helios canvas with the faint grid; plate; wide logos sized by width); a cover without a photo shows its icon', async () => {
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

  const iconCover = toRenderPost(d, { cover: null, slides: d.slides.map(() => null) }, meta);
  const iconHtml = renderToStaticMarkup(React.createElement(SlideTemplate, { post: iconCover, position: 0 }));
  assert.match(iconHtml, /helios-cover--icon/);
  assert.match(iconHtml, /helios-icon-bg helios-icon-bg--cover" aria-hidden="true" data-icon="landmark"/, "the Writer's cover icon");
  assert.doesNotMatch(iconHtml, /helios-cover-card/, 'the Helios-logo cover card is out (photo spec §6)');
  const css = (await import('node:fs')).readFileSync('app/social/render/preview/preview.css', 'utf8');
  // The faint grid stays: its removal was never decided (Tommy, 2026-10-07).
  assert.ok(/\.helios-cover--logo \{[^}]*linear-gradient/.test(css), 'the faint grid behind the logo card');
});

test('company: a usable article photo naming it is a candidate (dated by its page), next to its CEO and building', async () => {
  const b = briefWith({ name: 'Acme', role: 'company' });
  const page = { ok: true as const, url: 'https://news.example/a', resolvedUrl: 'https://news.example/a', title: null, byline: null, publishedTime: '2026-10-04T09:00:00Z', text: 'x', truncated: false, photos: [{ src: 'https://news.example/acme-launch.jpg', caption: 'The launch. (Courtesy of Acme)', credit: null, alt: null, from: 'figure' as const }] };
  const t = await search(b, { kind: 'company', query: 'Acme' }, await fakeLogoWeb(), [verified('Acme', 'Q1', 'organization')], { pages: [page] });
  const article = t.candidates.find((c) => c.lane === 'article');
  assert.equal(article?.url, 'https://news.example/acme-launch.jpg');
  assert.equal(article?.date, '2026-10-04');
});

// ── Link 1 (photo spec §2–§4): an organization is offered its logo, never its main photo ──

import { createSubjectAvailability } from '@/lib/social/photos/availability';

test('availability: an organization has logo_available from its verified P154; its main photo is never offered (logos only)', async () => {
  const b = briefWith({ name: 'Acme', role: 'AI company' });
  const cache = new Map([verified('Acme', 'Q1', 'organization')]);
  const http = await fakeLogoWeb({ p18: 'Acme HQ building portrait.jpg' });
  const a = await createSubjectAvailability({ jev: noJev, http }, () => cache)({ name: 'Acme', role: 'AI company' }, b);
  assert.deepEqual(a, { kind: 'organization', headshot: false, logo: true });
  const noLogo = await createSubjectAvailability({ jev: noJev, http: await fakeLogoWeb({ claims: [], p18: 'Acme HQ building portrait.jpg' }) }, () => cache)({ name: 'Acme', role: 'AI company' }, b);
  assert.deepEqual(noLogo, { kind: 'organization', headshot: false, logo: false }, 'no logo: nothing, even with a usable main photo');
  const neither = await createSubjectAvailability({ jev: noJev, http: await fakeLogoWeb({ claims: [] }) }, () => new Map([verified('Acme', 'Q1', 'organization')]))({ name: 'Acme', role: 'AI company' }, b);
  assert.deepEqual(neither, { kind: 'organization', headshot: false, logo: false });
});
