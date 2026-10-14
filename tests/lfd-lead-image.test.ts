import assert from 'node:assert/strict';
import test from 'node:test';

import { leadImage } from '@/lib/lfd/lead-image';
import type { Pick } from '@/lib/lfd/types';
import type { ArticlePhoto, PageRead } from '@/lib/social/reporter/read-page';

const pick = { key: 'a', refs: [], origin: 'reels', headline: 'H', sourceName: 'The Verge', url: 'https://s.com/a', body: '', publishedAt: null, net: 1, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, lane: 'rundown' } satisfies Pick;

const page = (photos: ArticlePhoto[]): PageRead => ({ ok: true, url: pick.url, resolvedUrl: pick.url, title: 'T', byline: null, publishedTime: null, text: 'x', truncated: false, photos });
const fig = (src: string, credit: string | null, width: number | null): ArticlePhoto => ({ src, caption: null, credit, alt: null, from: 'figure', width });
const og = (src: string, width?: number | null): ArticlePhoto => ({ src, caption: null, credit: null, alt: null, from: 'og:image', ...(width !== undefined ? { width } : {}) });
const reader = (r: PageRead) => {
  const urls: string[] = [];
  return { urls, read: async (url: string) => { urls.push(url); return r; } };
};

test('a credited figure at least 600 wide wins over og:image, largest first', async () => {
  const r = reader(page([og('https://s.com/og.jpg'), fig('https://s.com/small.jpg', 'AP', 400), fig('https://s.com/mid.jpg', 'Reuters', 800), fig('https://s.com/big.jpg', 'Getty', 1600)]));
  const out = await leadImage(r.read, pick, new Set());
  assert.deepEqual(r.urls, ['https://s.com/a']);
  assert.deepEqual(out!.photo, { src: 'https://s.com/big.jpg', credit: 'Getty', kind: 'scene' });
  assert.match(out!.note, /figure/);
});

test('small, uncredited or unsized figures are skipped; og:image is used with the outlet credit', async () => {
  const r = reader(page([fig('https://s.com/small.jpg', 'AP', 599), fig('https://s.com/nocredit.jpg', '  ', 1200), fig('https://s.com/nowidth.jpg', 'AP', null), og('https://s.com/og.jpg')]));
  const out = await leadImage(r.read, pick, new Set());
  assert.deepEqual(out!.photo, { src: 'https://s.com/og.jpg', credit: 'Image via The Verge', kind: 'scene' });
  assert.match(out!.note, /og:image/);
});

test('an og:image known to be under 600 wide is not used', async () => {
  assert.equal(await leadImage(reader(page([og('https://s.com/og.jpg', 300)])).read, pick, new Set()), null);
});

test('an excluded src is skipped', async () => {
  const out = await leadImage(reader(page([fig('https://s.com/big.jpg', 'Getty', 1600), og('https://s.com/og.jpg')])).read, pick, new Set(['https://s.com/big.jpg']));
  assert.equal(out!.photo.src, 'https://s.com/og.jpg');
});

test('svg, gif, logo, icon, avatar and sprite images are not photos', async () => {
  const junk = [
    fig('https://s.com/chart.svg', 'C', 1600),
    fig('https://s.com/anim.GIF', 'C', 1600),
    fig('https://s.com/Site-Logo-wide.jpg', 'C', 1600),
    fig('https://s.com/icons/x.jpg', 'C', 1600),
    fig('https://s.com/avatar-1.jpg', 'C', 1600),
    og('https://s.com/SPRITE.png'),
  ];
  assert.equal(await leadImage(reader(page(junk)).read, pick, new Set()), null);
});

test('no page, a failed read, or a page with no photos gives null', async () => {
  assert.equal(await leadImage(reader({ ok: false, url: pick.url, error: 'blocked' }).read, pick, new Set()), null);
  assert.equal(await leadImage(async () => { throw new Error('network'); }, pick, new Set()), null);
  assert.equal(await leadImage(reader(page([])).read, pick, new Set()), null);
});

test('logo/icon/avatar/sprite match whole path segments, not substrings', async () => {
  const pass = ['https://s.com/img/silicon-valley.jpg', 'https://s.com/img/iconic-photo.jpg'];
  for (const src of pass) {
    const out = await leadImage(reader(page([fig(src, 'AP', 1200)])).read, pick, new Set());
    assert.equal(out?.photo.src, src, src);
  }
  const skip = ['https://s.com/img/logo.png', 'https://s.com/icons/x.png', 'https://s.com/img/site_logo-2.jpg', 'https://s.com/avatars/a.jpg', 'https://s.com/img/sprite.png'];
  for (const src of skip) assert.equal(await leadImage(reader(page([fig(src, 'AP', 1200)])).read, pick, new Set()), null, src);
});
