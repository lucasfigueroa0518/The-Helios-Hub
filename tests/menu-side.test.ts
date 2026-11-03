import assert from 'node:assert/strict';
import test from 'node:test';

import { menuFlip, menuSide } from '@/components/social-hub/house/menu-side';

const bounds = { left: 0, right: 1200 };

test('a more button on the right edge opens the menu back into the row', () => {
  assert.equal(menuSide({ left: 1140, right: 1176 }, 200, bounds), 'right');
});

test('a more button with room on its right opens the menu that way', () => {
  assert.equal(menuSide({ left: 240, right: 276 }, 200, bounds), 'left');
});

test('a clipped drawer counts as the edge, not the window', () => {
  assert.equal(menuSide({ left: 860, right: 896 }, 200, { left: 400, right: 920 }), 'right');
});

test('a menu cut off by a scroller ending under the button flips above it', () => {
  assert.equal(menuFlip({ top: 800, bottom: 836 }, 160, { top: 0, bottom: 850 }), 'up');
});

test('a menu with room below stays below', () => {
  assert.equal(menuFlip({ top: 100, bottom: 136 }, 160, { top: 0, bottom: 850 }), 'down');
});
