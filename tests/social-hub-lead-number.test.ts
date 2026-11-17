/** The lead number on a posted Week-board card (Calendar look-back). Pure, offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubPost } from '@/lib/social-hub/types';
import { leadNumber, type Typicals } from '@/lib/social-hub/views/typical';

const reel = (views: number | null, status: HubPost['status'] = 'published') =>
  ({ id: 'r', vertical: 'reels', format: 'reel', status, metrics: { views }, history: [] }) as unknown as HubPost;
const typical = (n: number | null): Typicals => () => n;

test('a posted reel leads with views against typical', () => {
  const l = leadNumber(reel(13600), typical(6400))!;
  assert.equal(l.vs, '2.1×');
  assert.match(l.value, /13\.6K/i);
  assert.match(l.label, /views, 2\.1× typical$/);
});

test('about typical reads as ≈; no typical yet shows the number alone', () => {
  assert.equal(leadNumber(reel(1000), typical(1000))!.vs, '≈');
  assert.equal(leadNumber(reel(1000), typical(null))!.vs, null);
});

test('nothing before it posts or before insights land', () => {
  assert.equal(leadNumber(reel(1000, 'scheduled'), typical(1000)), null);
  assert.equal(leadNumber(reel(null), typical(1000)), null);
});
