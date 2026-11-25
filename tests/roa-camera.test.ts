/**
 * The camera card (RA-26): EXIF read from Commons and NASA, the card's wording, and the Commons credit cleanup.
 * Pure functions; no network, no model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { bodyName, commonsCamera, dateOf, nasaCamera, num, originOf, receiptOf, shutter } from '@/lib/stories/roa/camera';
import { artistName } from '@/lib/stories/roa/real';

test('num reads EXIF rationals and plain numbers', () => {
  assert.equal(num('3900/10'), 390);
  assert.equal(num('8/1'), 8);
  assert.equal(num(100), 100);
  assert.equal(num('1/0'), undefined);
  assert.equal(num('n/a'), undefined);
  assert.equal(num(0), undefined);
});

test('bodyName writes the camera the way people say it', () => {
  assert.equal(bodyName('NIKON CORPORATION', 'NIKON D7200'), 'Nikon D7200');
  assert.equal(bodyName('Canon', 'Canon EOS 5D Mark IV'), 'Canon EOS 5D Mark IV');
  assert.equal(bodyName('Apple', 'iPhone 12 Pro'), 'iPhone 12 Pro');
  assert.equal(bodyName('Google', 'Pixel 7'), 'Pixel 7');
  assert.equal(bodyName('', ''), undefined);
});

test('dateOf and shutter', () => {
  assert.equal(dateOf('2022:04:11 07:51:54'), '2022-04-11');
  assert.equal(dateOf('2019'), undefined);
  assert.equal(dateOf('2022:13:01'), undefined);
  assert.equal(shutter(1 / 640), '1/640 s');
  assert.equal(shutter(0.5), '1/2 s');
  assert.equal(shutter(2), '2 s');
});

test('commonsCamera reads the API metadata list (the Lab 3 flamingo)', () => {
  const metadata = [
    { name: 'Make', value: 'NIKON CORPORATION' }, { name: 'Model', value: 'NIKON D7200' },
    { name: 'ExposureTime', value: '1/640' }, { name: 'FNumber', value: '8/1' }, { name: 'ISOSpeedRatings', value: 100 },
    { name: 'DateTimeOriginal', value: '2022:04:11 07:51:54' }, { name: 'FocalLength', value: '3900/10' },
  ];
  assert.deepEqual(commonsCamera(metadata), { body: 'Nikon D7200', focalMm: 390, fNumber: 8, exposureS: 1 / 640, iso: 100, taken: '2022-04-11' });
  assert.equal(commonsCamera([]), undefined);
  assert.equal(commonsCamera(null), undefined);
});

test('nasaCamera reads prefixed keys', () => {
  assert.deepEqual(nasaCamera({ 'EXIF:Make': 'NIKON CORPORATION', 'EXIF:Model': 'NIKON D5', 'EXIF:ISO': 800, 'Composite:LensID': 'AF-S 70-200mm f/2.8' }), {
    body: 'Nikon D5', lens: 'AF-S 70-200mm f/2.8', iso: 800,
  });
  assert.equal(nasaCamera({ 'AVAIL:Title': 'x' }), undefined);
});

test('receiptOf: camera, settings, when and where; "Taken" when only the date or place is known; null when empty', () => {
  const base = { kind: 'commons' as const, url: 'u', licence: 'CC BY-SA 4.0', credit: 'c' };
  assert.deepEqual(receiptOf({ ...base, place: 'Lake Nakuru', year: '2022', camera: { body: 'Nikon D7200', focalMm: 390, fNumber: 8, exposureS: 1 / 640, iso: 100, taken: '2022-04-11' } }), {
    head: 'Shot on', rows: ['Nikon D7200', '390 mm · f/8 · 1/640 s · ISO 100', 'April 2022 · Lake Nakuru'],
  });
  assert.deepEqual(receiptOf({ ...base, year: '2019', place: 'Houston' }), { head: 'Taken', rows: ['2019 · Houston'] });
  assert.equal(receiptOf(base), null);
  assert.equal(receiptOf({ kind: 'generated', model: 'm', prompt: 'p', createdAt: 'c' }), null);
});

test('originOf (RA-27): what made an AI image and where it came from; null for a real photo', () => {
  assert.deepEqual(originOf({ kind: 'dataset', dataset: 'Example set', id: '1', model: 'Midjourney v6' }), { head: 'Made with', rows: ['Midjourney v6', 'From the Example set dataset'] });
  assert.deepEqual(originOf({ kind: 'viral', url: 'u', firstSeen: '2025-03-02' }), { head: 'Made with', rows: ['An AI image model', 'Shared online · March 2025'] });
  assert.deepEqual(originOf({ kind: 'viral', url: 'u' }), { head: 'Made with', rows: ['An AI image model', 'Shared online'] });
  assert.deepEqual(originOf({ kind: 'generated', model: 'gpt-image-2', prompt: '', createdAt: 'c' }), { head: 'Made with', rows: ['gpt-image-2'] });
  assert.equal(originOf({ kind: 'commons', url: 'u', licence: 'l', credit: 'c' }), null);
});

test('artistName keeps the user-page link text, not the sentence around it', () => {
  assert.equal(artistName('This Photo was taken by <a href="//commons.wikimedia.org/wiki/User:Jane_Doe" title="User:Jane Doe">Jane Doe</a>.'), 'Jane Doe');
  assert.equal(artistName('<a href="https://de.wikipedia.org/wiki/Benutzer:Max">Max M.</a>'), 'Max M.');
  assert.equal(artistName('NASA/Bill Ingalls'), 'NASA/Bill Ingalls');
  assert.equal(artistName(undefined), '');
});
