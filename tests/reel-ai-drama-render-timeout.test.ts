import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { projectSeconds, renderTimeoutMs, RENDER_TIMEOUT_MAX_MS, RENDER_TIMEOUT_MS } from '@/lib/reel-ai-drama/render/video';

const dirWith = (html: string | null) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
  if (html !== null) fs.writeFileSync(path.join(dir, 'index.html'), html);
  return dir;
};

test('projectSeconds reads the latest start + duration on the page', () => {
  assert.equal(projectSeconds('<div data-composition-id="root" data-duration="77.4"><div data-start="70" data-duration="7.4"></div></div>'), 77.4);
  assert.equal(projectSeconds('<div data-start="10" data-duration="80"></div>'), 90);
  assert.equal(projectSeconds('<div></div>'), null);
});

test('the timeout scales with the reel, between 30 and 90 minutes', () => {
  // last night's reel: 2,322 frames (77.4 s) needs ~70 min at 3 min per 100 frames
  assert.equal(renderTimeoutMs(dirWith('<div data-duration="77.4"></div>')), Math.ceil(((77.4 * 30) / 100) * 180_000));
  assert.equal(renderTimeoutMs(dirWith('<div data-duration="10"></div>')), RENDER_TIMEOUT_MS);
  assert.equal(renderTimeoutMs(dirWith('<div data-duration="300"></div>')), RENDER_TIMEOUT_MAX_MS);
});

test('a page whose length cannot be read gets 60 minutes', () => {
  assert.equal(renderTimeoutMs(dirWith('<div></div>')), 60 * 60_000);
  assert.equal(renderTimeoutMs(dirWith(null)), 60 * 60_000);
});
