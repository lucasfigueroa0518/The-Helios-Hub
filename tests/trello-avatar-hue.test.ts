import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AVATAR_HUES, hueFromString } from '@/lib/trello/session';

function hueDistance(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

describe('trello avatar hues', () => {
  it('picks a stable palette color instead of a nearby raw degree', () => {
    const lucas = hueFromString('lucas@heliosgroup.ai');
    const tommy = hueFromString('tommy@heliosgroup.ai');
    assert.ok(AVATAR_HUES.includes(lucas as (typeof AVATAR_HUES)[number]));
    assert.ok(AVATAR_HUES.includes(tommy as (typeof AVATAR_HUES)[number]));
    assert.notEqual(lucas, tommy);
    assert.ok(hueDistance(lucas, tommy) >= 60);
    assert.equal(hueFromString('lucas@heliosgroup.ai'), lucas);
  });

  it('keeps neighboring palette slots in different color families', () => {
    for (let i = 0; i < AVATAR_HUES.length; i++) {
      const next = AVATAR_HUES[(i + 1) % AVATAR_HUES.length];
      assert.ok(hueDistance(AVATAR_HUES[i], next) >= 40);
    }
  });
});
