import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAtmosphere } from '../lib/social/photos/atmosphere';
import { resolveSubject } from '../lib/social/photos/subjects';

test('resolveSubject finds a known named subject by name (case-insensitive)', () => {
  assert.equal(resolveSubject('Dario Amodei'), 'https://en.wikipedia.org/wiki/Dario_Amodei');
  assert.equal(resolveSubject('DARIO AMODEI'), 'https://en.wikipedia.org/wiki/Dario_Amodei');
  assert.equal(resolveSubject('  dario amodei  '), 'https://en.wikipedia.org/wiki/Dario_Amodei');
});

test('resolveSubject returns null for an unknown subject', () => {
  assert.equal(resolveSubject('Nobody In Particular'), null);
});

test('resolveAtmosphere finds a curated photo by keyword', () => {
  const photo = resolveAtmosphere('boardroom');
  assert.ok(photo, 'boardroom keyword should resolve');
  assert.ok(photo?.url.startsWith('https://images.unsplash.com/'), 'URL points to Unsplash CDN');
  assert.ok(photo?.attribution.photographer.length > 0, 'attribution names a photographer');
});

test('resolveAtmosphere returns null for an unknown keyword', () => {
  assert.equal(resolveAtmosphere('quantum-tea'), null);
});

test('every atmosphere entry carries required attribution fields', async () => {
  const { ATMOSPHERE_LIBRARY } = await import('../lib/social/photos/atmosphere');
  for (const [keyword, photo] of Object.entries(ATMOSPHERE_LIBRARY)) {
    assert.ok(photo.id.length > 0, `${keyword}: id present`);
    assert.ok(photo.url.startsWith('https://images.unsplash.com/'), `${keyword}: URL is Unsplash CDN`);
    assert.ok(photo.attribution.photographer.length > 0, `${keyword}: photographer credit`);
    assert.ok(photo.attribution.profileUrl.startsWith('https://unsplash.com/'), `${keyword}: profile URL`);
  }
});
