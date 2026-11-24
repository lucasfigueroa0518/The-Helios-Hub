import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RUN_HANG_BACKSTOP_MS } from '@/lib/content-runs/hang-guard';
import { projectSeconds, renderTimeoutMs, RENDER_TIMEOUT_MS } from '@/lib/reel-ai-drama/render/video';

test('projectSeconds reads the latest start + duration on the page', () => {
  assert.equal(projectSeconds('<div data-composition-id="root" data-duration="77.4"><div data-start="70" data-duration="7.4"></div></div>'), 77.4);
  assert.equal(projectSeconds('<div data-start="10" data-duration="80"></div>'), 90);
  assert.equal(projectSeconds('<div></div>'), null);
});

test('a render is never killed for its length: only the 12 h hang backstop applies', () => {
  assert.equal(RUN_HANG_BACKSTOP_MS, 12 * 60 * 60_000);
  assert.equal(RENDER_TIMEOUT_MS, RUN_HANG_BACKSTOP_MS);
  assert.equal(renderTimeoutMs('/nowhere'), RUN_HANG_BACKSTOP_MS);
});
