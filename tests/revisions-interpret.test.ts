/** Targeted Revisions task 3: Haiku interpreter (offline; `complete` is stubbed). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { interpret, type Complete } from '@/lib/revisions/interpret';
import { registerDescription, restoreRegistryForTest } from '@/lib/revisions/registry';
import type { ContentTypeDescription, PostSnapshot } from '@/lib/revisions/types';

const desc: ContentTypeDescription = {
  vertical: 'carousels',
  label: 'carousels',
  stageTags: ['photo_pick', 'copy_write'],
  fixKinds: ['photo', 'wording'],
  load: async () => null,
  estimate: () => 0.01,
  revise: async () => ({ ok: false, reason: 'failed', note: 'x' }),
  restore: async () => {},
  unschedule: async () => ({ ok: true, note: '' }),
};

const snapshot: PostSnapshot = {
  vertical: 'carousels',
  refs: { postId: 'p1' },
  status: 'review',
  parts: [
    { ref: { kind: 'slide', key: '2' }, text: 'Two', photoUrl: 'https://x/2.jpg', photoCredit: 'Ann' },
    { ref: { kind: 'slide', key: '3' }, text: 'Three headline', photoUrl: 'https://x/3.jpg' },
  ],
};

const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function stub(text: string) {
  const calls: Parameters<Complete>[0][] = [];
  const complete: Complete = async (req) => {
    calls.push(req);
    return { text, usage };
  };
  return { complete, calls };
}

async function withDesc<T>(fn: () => Promise<T>): Promise<T> {
  registerDescription(desc);
  try {
    return await fn();
  } finally {
    restoreRegistryForTest();
  }
}

const okJson = JSON.stringify({
  status: 'ok',
  part: { kind: 'slide', key: '3' },
  fixKind: 'photo',
  stageTag: 'photo_pick',
  instruction: 'use a photo of the CEO',
});

test("returns ok with part frame 3, fix photo, stageTag from the type's list", async () => {
  await withDesc(async () => {
    const { complete } = stub(okJson);
    const r = await interpret({ complete }, { snapshot, sentence: 'slide 3 needs the CEO photo' });
    assert.equal(r.status, 'ok');
    if (r.status !== 'ok') return;
    assert.deepEqual(r.interpretation.part, { kind: 'slide', key: '3' });
    assert.equal(r.interpretation.fixKind, 'photo');
    assert.equal(r.interpretation.stageTag, 'photo_pick');
    assert.equal(r.interpretation.vertical, 'carousels');
    assert.ok(r.costUsd > 0);
  });
});

test('a sentence naming a part not in the snapshot returns ask', async () => {
  await withDesc(async () => {
    const { complete } = stub(okJson.replace('"3"', '"9"'));
    const r = await interpret({ complete }, { snapshot, sentence: 'slide 9 is bad' });
    assert.equal(r.status, 'ask');
  });
});

test('malformed JSON from the model returns ask, not a throw', async () => {
  await withDesc(async () => {
    const { complete } = stub('not json {');
    const r = await interpret({ complete }, { snapshot, sentence: 'fix it' });
    assert.equal(r.status, 'ask');
  });
});

test("a stageTag outside the type's STAGE_TAGS returns ask", async () => {
  await withDesc(async () => {
    const { complete } = stub(okJson.replace('photo_pick', 'bogus'));
    const r = await interpret({ complete }, { snapshot, sentence: 'x' });
    assert.equal(r.status, 'ask');
  });
});

test('a fixKind outside the type, or a missing field, returns ask', async () => {
  await withDesc(async () => {
    assert.equal((await interpret(stub(okJson.replace('"photo"', '"motion"')), { snapshot, sentence: 'x' })).status, 'ask');
    const { instruction: _i, ...missing } = JSON.parse(okJson);
    assert.equal((await interpret(stub(JSON.stringify(missing)), { snapshot, sentence: 'x' })).status, 'ask');
  });
});

test('the model can ask a question back', async () => {
  await withDesc(async () => {
    const { complete } = stub(JSON.stringify({ status: 'ask', question: 'Which slide?' }));
    const r = await interpret({ complete }, { snapshot, sentence: 'fix the photo' });
    assert.equal(r.status, 'ask');
    if (r.status === 'ask') assert.equal(r.question, 'Which slide?');
  });
});

test('the request marks cache_control on the static system block and not on the post block', async () => {
  await withDesc(async () => {
    const { complete, calls } = stub(okJson);
    await interpret({ complete }, { snapshot, sentence: 'slide 3 photo' });
    const req = calls[0]!;
    assert.equal(req.model, 'claude-haiku-5-5');
    const sys = req.system as Array<{ text: string; cache_control?: unknown }>;
    assert.ok(sys[sys.length - 1]!.cache_control);
    assert.match(sys.map((b) => b.text).join('\n'), /photo_pick/);
    assert.doesNotMatch(JSON.stringify(sys), /Three headline/);
    const body = JSON.stringify(req.messages);
    assert.match(body, /Three headline/);
    assert.match(body, /https:\/\/x\/3\.jpg/);
    assert.match(body, /slide 3 photo/);
    assert.doesNotMatch(body, /cache_control/);
  });
});

test('a prior question and reply are included as context', async () => {
  await withDesc(async () => {
    const { complete, calls } = stub(okJson);
    await interpret(
      { complete },
      { snapshot, sentence: 'the third one', prior: { sentence: 'fix the photo', question: 'Which slide?' } },
    );
    const body = JSON.stringify(calls[0]!.messages);
    assert.match(body, /fix the photo/);
    assert.match(body, /Which slide\?/);
    assert.match(body, /the third one/);
  });
});

test('a vertical with no description returns ask', async () => {
  const { complete } = stub(okJson);
  const r = await interpret({ complete }, { snapshot: { ...snapshot, vertical: 'reels' }, sentence: 'x' });
  assert.equal(r.status, 'ask');
});
