/**
 * The AI Drama Reels publish driver (lib/publishing/drivers/reel-ai-drama.ts, HUB-WIRING-CONTRACT §5):
 * its identity, and that each method reads the drama rules on the drama handle. A scripted database;
 * no network (fetch throws if anything tries).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { reelAiDramaDriver } from '@/lib/publishing/drivers/reel-ai-drama';

function fakeDb(settings: Record<string, unknown>) {
  const seen: string[] = [];
  return {
    seen,
    query: async (text: string, params?: unknown[]) => {
      seen.push(text.replace(/\s+/g, ' ').trim());
      if (/FROM reel_ai_drama\.settings/.test(text)) {
        const key = String(params?.[0]);
        return { rows: key in settings ? [{ value: settings[key] }] : [] };
      }
      return { rows: [] };
    },
  };
}

const realFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = (async () => { throw new Error('no network in tests'); }) as typeof fetch;
});
test.after(() => {
  globalThis.fetch = realFetch;
});

const build = (db: ReturnType<typeof fakeDb>) => {
  const made = { meta: 0, token: 0 };
  const driver = reelAiDramaDriver({
    db: db as never,
    meta: () => { made.meta += 1; return {} as never; },
    signVideo: async () => 'https://signed.example/video.mp4',
    token: () => { made.token += 1; return 'test-token'; },
  });
  return { driver, made };
};

test('the driver is reel_ai_drama and cancels an unapproved slot at release', () => {
  const { driver, made } = build(fakeDb({}));
  assert.equal(driver.vertical, 'reel_ai_drama');
  assert.equal(driver.refusesAtRelease, 'cancel');
  // Nothing live is built until a method runs.
  assert.deepEqual(made, { meta: 0, token: 0 });
});

test('live and requireApproval read reel_ai_drama.settings: off and required unless stored otherwise', async () => {
  assert.equal(await build(fakeDb({})).driver.live(), false);
  assert.equal(await build(fakeDb({ publishing_live: true })).driver.live(), true);
  assert.equal(await build(fakeDb({})).driver.requireApproval(), true);
  assert.equal(await build(fakeDb({ require_approval: false })).driver.requireApproval(), false);
});

test('failStale and releaseDue run against the spine for drama only', async () => {
  const db = fakeDb({});
  const { driver } = build(db);
  await driver.failStale();
  await driver.releaseDue();
  assert.ok(db.seen.some((s) => s.startsWith('UPDATE social_hub.publish_attempts') && s.includes("reel_ai_drama")), 'stale attempts are drama rows');
  assert.ok(db.seen.some((s) => s.includes('social_hub.schedule')), 'release reads the spine schedule');
});

test('pollInsights builds the insights client from the token, and with nothing to read makes no call', async () => {
  const db = fakeDb({});
  const { driver, made } = build(db);
  await driver.pollInsights();
  assert.equal(made.token, 1);
});
