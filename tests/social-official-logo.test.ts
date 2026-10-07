/**
 * Helios Social: image strategy (a) official images and (b) logo cover cards
 * (spec §5.1; Tommy approved the build 2026-10-07). Offline: fake web, stub
 * Jev and vision.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { classifyCredit } from '@/lib/social/photos/credit';
import { findPhoto, newPhotoContext, type Photo } from '@/lib/social/photos/find';
import type { IdentityResult } from '@/lib/social/photos/identity';
import { currentLogoFile, fetchLogo, plateFor } from '@/lib/social/photos/logo';
import { OFFICIAL_COMPANIES, officialPageOf, type OfficialCompany } from '@/lib/social/photos/official';
import { passesOfficialVision, passesVision, type VisionCheck, type VisionVerdict } from '@/lib/social/photos/vision';
import { toRenderPost } from '@/lib/social/render/from-draft';
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import { fillDraft } from '@/lib/social/writer/draft';
import { briefForWriter } from '@/lib/social/writer/writer';
import { sifDraftHandoff } from '@/fixtures/social/drafts';

const approved = (over: Partial<OfficialCompany> = {}): OfficialCompany[] =>
  OFFICIAL_COMPANIES.map((c) => (c.company === 'Google' ? { ...c, approved: true, editorialUse: 'permitted' as const, ...over } : c));

function googleBrief(): Brief {
  const b = briefSuperIntelligenceForce();
  b.subjects = [...b.subjects, { id: 'S9', name: 'Google', role: 'company' }];
  return b;
}

const page = (url: string, photos: PageReadOk['photos']): PageReadOk => ({ ok: true, url, resolvedUrl: url, title: null, byline: null, publishedTime: null, text: 'x', truncated: false, photos });

test('allow-list: every starting row is TBD and not approved; nothing is official until Tommy approves a row', () => {
  for (const c of OFFICIAL_COMPANIES) {
    assert.equal(c.approved, false, c.company);
    assert.equal(c.editorialUse, 'TBD', c.company);
  }
  assert.deepEqual(OFFICIAL_COMPANIES.map((c) => c.company), ['Anthropic', 'OpenAI', 'Google', 'Meta', 'Microsoft', 'Nvidia', 'Mistral AI', 'xAI']);
  const r = officialPageOf('https://blog.google/products/gemini/x', ['Google']);
  assert.equal(r.status, 'not-approved');
});

test('allow-list match: the company must be a story subject and the page on one of its domains (subdomains count); a partner page never counts', () => {
  const list = approved();
  assert.equal(officialPageOf('https://blog.google/x', ['Google'], list).status, 'official');
  assert.equal(officialPageOf('https://workspace.google.com/x', ['Google'], list).status, 'official', 'subdomain');
  assert.equal(officialPageOf('https://blog.google/x', ['Microsoft'], list).status, 'none', 'Google is not in this story');
  assert.equal(officialPageOf('https://googlepartner.example.com/x', ['Google'], list).status, 'none', 'partner-hosted page');
  assert.equal(officialPageOf('https://notgoogle.com/x', ['Google'], list).status, 'none', 'not a subdomain');
  assert.equal(officialPageOf('https://blog.google/x', ['Google'], approved({ editorialUse: 'not-permitted' })).status, 'not-approved', 'terms must permit editorial use');
});

test('credit: an approved official page needs no credit line and gets "Image: <Company>"; an agency credit still rejects; unapproved stays unknown', () => {
  const organizations = ['Google'];
  const ok = classifyCredit({ caption: null, credit: null, page: 'https://blog.google/x', organizations, officialList: approved() });
  assert.deepEqual(ok, { verdict: 'allowed', reason: 'official page of Google', credit: 'Image: Google' });
  const getty = classifyCredit({ caption: 'Sundar Pichai on stage', credit: 'Getty Images', page: 'https://blog.google/x', organizations, officialList: approved() });
  assert.equal(getty.verdict, 'rejected');
  const tbd = classifyCredit({ caption: null, credit: null, page: 'https://blog.google/x', organizations });
  assert.equal(tbd.verdict, 'unknown');
  assert.match(tbd.reason, /official page of Google, but Google row not approved yet/);
});

test("Writer brief: <figure> images before og:image; a page's og:image dropped when it has a usable figure; official images marked official_image_of", async () => {
  const b = googleBrief();
  b.article_photos = [
    { caption: null, credit: null, url: 'https://blog.google/og-card.png', page: 'https://blog.google/post' },
    { caption: 'The new Gemini sidebar', credit: null, url: 'https://blog.google/figure-1.png', page: 'https://blog.google/post' },
  ];
  const pages = [page('https://blog.google/post', [
    { src: 'https://blog.google/figure-1.png', caption: 'The new Gemini sidebar', credit: null, alt: null, from: 'figure' },
    { src: 'https://blog.google/og-card.png', caption: null, credit: null, alt: null, from: 'og:image' },
  ])];
  const w = await briefForWriter(b, async () => false, async () => false, pages, approved());
  assert.deepEqual(w.article_photos.map((p) => p.url), ['https://blog.google/figure-1.png']);
  assert.equal((w.article_photos[0] as { official_image_of?: string }).official_image_of, 'Google');
  const unapproved = await briefForWriter(b, async () => false, async () => false, pages);
  assert.deepEqual(unapproved.article_photos, [], 'not approved → unknown → not listed');
});

const verdict = (over: Partial<VisionVerdict> = {}): VisionVerdict => ({ what_it_shows: 'x', shows_requested: true, shows_requested_confidence: 0.9, person_prominent: false, landmark_visible: false, story_logo: false, logo_seen: null, named_institution: false, mostly_text_banner: false, ...over });

test('vision: the sixth question (mostly text or a graphic banner) rejects an official image; stock ignores it', () => {
  assert.ok(passesOfficialVision(verdict(), false));
  assert.ok(!passesOfficialVision(verdict({ mostly_text_banner: true }), false));
  assert.ok(passesVision(verdict({ mostly_text_banner: true })));
});

/** Identity already verified (no Jev / resolver in these tests). */
const verified = (name: string, qid: string, type: 'organization' | 'person'): [string, Promise<IdentityResult>] => [name, Promise.resolve({ ok: true, scores: { person: 0, matches: [] }, qid, label: name, description: '', type, via: 'resolver' })];

/** Fake web: Wikidata P154 claims, Commons imageinfo with a rendered PNG, the PNG itself. */
async function fakeLogoWeb(opts: { licence?: string; dark?: boolean; claims?: unknown[] } = {}): Promise<typeof fetch> {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 400, height: 160, channels: 4, background: opts.dark ? { r: 20, g: 20, b: 20, alpha: 1 } : { r: 240, g: 240, b: 240, alpha: 1 } } }).png().toBuffer();
  const claims = opts.claims ?? [{ rank: 'normal', mainsnak: { datavalue: { value: 'Google 2015 logo.svg' } } }];
  return (async (url: string) => {
    const u = String(url);
    if (u.includes('wikidata.org')) return new Response(JSON.stringify({ entities: { Q95: { claims: { P154: claims } } } }));
    if (u.includes('commons.wikimedia.org/w/api.php')) {
      return new Response(JSON.stringify({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb/google-logo.png', thumbwidth: 800, thumbheight: 320, extmetadata: { LicenseShortName: { value: opts.licence ?? 'Public domain' } } }] } } } }));
    }
    if (u.includes('upload.wikimedia.org')) return new Response(new Uint8Array(png));
    throw new Error(`unexpected fetch ${u}`);
  }) as unknown as typeof fetch;
}

test('logo: the current P154 value (preferred rank, else no end date, latest start)', () => {
  const v = (value: string, extra: Record<string, unknown> = {}) => ({ rank: 'normal' as const, mainsnak: { datavalue: { value } }, ...extra });
  assert.equal(currentLogoFile([v('old.svg', { qualifiers: { P582: [{ datavalue: { value: { time: '+2015' } } }] } }), v('new.svg')]), 'new.svg');
  assert.equal(currentLogoFile([v('a.svg'), v('b.svg', { rank: 'preferred' })]), 'b.svg');
  assert.equal(currentLogoFile([v('2010.svg', { qualifiers: { P580: [{ datavalue: { value: { time: '+2010' } } }] } }), v('2020.svg', { qualifiers: { P580: [{ datavalue: { value: { time: '+2020' } } }] } })]), '2020.svg');
  assert.equal(currentLogoFile([v('x.svg', { rank: 'deprecated' })]), null);
});

test('logo: a dark logo gets a light plate and a light logo a dark plate; a non-free licence means no card', async () => {
  const sharp = (await import('sharp')).default;
  const dark = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } } }).png().toBuffer();
  assert.equal(await plateFor(dark), 'light');
  const r = await fetchLogo('Q95', 'Google', { http: await fakeLogoWeb() });
  assert.ok(r.photo);
  assert.equal(r.photo.source, 'logo');
  assert.equal(r.photo.plate, 'dark', 'a light logo on a dark plate');
  assert.equal(r.photo.credit, 'Logo: Google (public domain) · Wikimedia Commons');
  const nonFree = await fetchLogo('Q95', 'Google', { http: await fakeLogoWeb({ licence: 'Fair use' }) });
  assert.equal(nonFree.photo, null);
});

test('cover order for a company story: official image → (subject P18) → logo card → stock → starter', async () => {
  const b = googleBrief();
  const http = await fakeLogoWeb({ dark: true });
  const pages = [page('https://blog.google/post', [
    { src: 'https://blog.google/banner.png', caption: null, credit: null, alt: null, from: 'figure' },
    { src: 'https://blog.google/sidebar.png', caption: 'The new Gemini sidebar', credit: null, alt: null, from: 'figure' },
    { src: 'https://blog.google/og.png', caption: null, credit: null, alt: null, from: 'og:image' },
  ])];
  const asked: string[] = [];
  const vision: VisionCheck = async ({ url }) => {
    asked.push(url);
    const v = verdict({ mostly_text_banner: url.endsWith('banner.png') });
    return { ok: true, verdict: v, pass: passesVision(v), costUsd: 0.0025 };
  };
  const jev = (async () => { throw new Error('no Jev in this test'); }) as never;
  const ctx = () => {
    const c = newPhotoContext(b, pages);
    c.identities = new Map([verified('Google', 'Q95', 'organization')]);
    return c;
  };
  const cover = { text: ['Google puts Gemini in every Workspace app'], speaker: null, slot: 'split' as const, cover: true };
  const request = { kind: 'stock' as const, value: 'office laptop' };

  // Approved: the official figure image wins (the banner is rejected by vision; og:image never reached).
  const a = await findPhoto(request, ctx(), { jev, http, vision, officialList: approved(), stock: async () => [] }, cover);
  assert.equal(a.via, 'official');
  assert.equal(a.photo?.url, 'https://blog.google/sidebar.png');
  assert.equal(a.photo?.credit, 'Image: Google');
  assert.deepEqual(asked, ['https://blog.google/banner.png', 'https://blog.google/sidebar.png']);

  // Not approved (the default list): no official image → the logo card.
  const l = await findPhoto(request, ctx(), { jev, http, vision, stock: async () => [] }, cover);
  assert.equal(l.via, 'logo');
  assert.equal(l.photo?.plate, 'light');
  assert.ok(l.steps.some((s) => /official image .*credit unknown \(official page of Google, but Google row not approved yet\)/.test(s)), l.steps.join(' | '));

  // The logo used in the last 7 days → stock (none here) → the AI-compute starter.
  const c3 = ctx();
  c3.recent.add('https://upload.wikimedia.org/thumb/google-logo.png');
  const s = await findPhoto(request, c3, { jev, http, vision, stock: async () => [] }, cover);
  assert.equal(s.via, 'starter');
  assert.ok(s.steps.some((x) => /logo card: this logo was used/.test(x)));
});

test('a person cover keeps the person first; the logo card is for the company named in the cover, and never for a person', async () => {
  const b = googleBrief();
  const http = await fakeLogoWeb();
  const c = newPhotoContext(b, []);
  c.identities = new Map([verified('Google', 'Q95', 'organization'), ['Jay Clayton', Promise.resolve({ ok: false, reason: 'no match', type: 'person', scores: null } as IdentityResult)]]);
  const t = await findPhoto({ kind: 'subject', value: 'Jay Clayton' }, c, { jev: (async () => { throw new Error('x'); }) as never, http }, { text: ['Jay Clayton joins Google'], speaker: null, slot: 'split', cover: true });
  assert.equal(t.via, 'logo');
  assert.equal((t.photo as Photo).subject, 'Google');
  assert.ok(t.steps.some((s) => /identity failed/.test(s)), 'the person was tried first');
});

test('render: a logo photo makes a logo-card cover (logo kind, plate, Helios wordmark), the logo whole (object-fit contain)', async () => {
  const d = fillDraft(sifDraftHandoff(), briefSuperIntelligenceForce());
  const logo: Photo = { url: 'https://upload.wikimedia.org/thumb/google-logo.png', credit: 'Logo: Google (public domain) · Wikimedia Commons', source: 'logo', width: 800, height: 320, qid: 'Q95', subject: 'Google', plate: 'dark' };
  const post = toRenderPost(d, { cover: logo, slides: d.slides.map(() => null) }, { source: 'x', sourceUrl: '', publishedAt: '2026-10-07T00:00:00Z' });
  assert.equal(post.slides[0]!.photoKind, 'logo');
  assert.equal(post.slides[0]!.logoPlate, 'dark');
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SlideTemplate } = await import('@/lib/social/render/SlideTemplate');
  const html = renderToStaticMarkup(React.createElement(SlideTemplate, { post, position: 0 }));
  assert.match(html, /helios-cover--logo/);
  assert.match(html, /helios-logo-card__plate--dark/);
  assert.match(html, /helios-logo-card__wordmark">HELIOS/);
  assert.match(html, /data-photo-kind="logo"/);
  assert.match(html, /Logo: Google \(public domain\)/);
});
