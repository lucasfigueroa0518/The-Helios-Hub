import assert from 'node:assert/strict';
import test from 'node:test';

import { DUPE_CHECK_MAX, FIELD_NOTES_DUPE, findPostedDuplicates } from '@/lib/field-notes/sources/dupe-check';

const stub = (answer: (state: { posted: string[]; candidate: { untrusted_content: string } }) => number | Error) => {
  const seen: unknown[] = [];
  return {
    seen,
    jev: {
      systemOne: async (state: unknown) => {
        seen.push(state);
        const a = answer(state as never);
        if (a instanceof Error) throw a;
        return { answers: { same_as_posted: a }, usage: { input_tokens: 500, output_tokens: 0 } };
      },
    } as never,
  };
};

test('dupe check: a reworded item about a posted feature is flagged; a different one is not', async () => {
  const s = stub((st) => (/reply to your agents from your phone/i.test(st.candidate.untrusted_content) ? 0.9 : 0.1));
  const r = await findPostedDuplicates(
    [
      { id: 'a', untrustedContent: 'Now you can reply to your agents from your phone while they run on your laptop.' },
      { id: 'b', untrustedContent: 'A new spreadsheet helper writes formulas for you.' },
    ],
    ['Remote control for local agents'],
    { jev: s.jev },
  );
  assert.deepEqual(r.duplicates, ['a']);
  assert.equal(r.asked, 2);
  const state = s.seen[0] as { posted: string[]; candidate: Record<string, unknown> };
  assert.deepEqual(state.posted, ['Remote control for local agents']);
  assert.deepEqual(Object.keys(state.candidate), ['untrusted_content'], 'scraped text only under untrusted_content');
});

test('dupe check: nothing posted or no Jev asks nothing; a failed call is not a duplicate; at most DUPE_CHECK_MAX asked', async () => {
  assert.deepEqual(await findPostedDuplicates([{ id: 'a', untrustedContent: 'x' }], [], { jev: stub(() => 1).jev }), { duplicates: [], asked: 0 });
  assert.deepEqual(await findPostedDuplicates([{ id: 'a', untrustedContent: 'x' }], ['P'], { jev: null }), { duplicates: [], asked: 0 });
  assert.deepEqual(await findPostedDuplicates([{ id: 'a', untrustedContent: 'x' }], ['P'], { jev: stub(() => new Error('down')).jev }), { duplicates: [], asked: 1 });
  const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), untrustedContent: `item ${i}` }));
  const s = stub(() => 0);
  const r = await findPostedDuplicates(many, ['P'], { jev: s.jev });
  assert.equal(r.asked, DUPE_CHECK_MAX);
  assert.equal(s.seen.length, DUPE_CHECK_MAX);
});

test('dupe check wording names no tool and marks the text untrusted', () => {
  const text = JSON.stringify(FIELD_NOTES_DUPE.questions);
  assert.match(text, /untrusted/);
  for (const name of ['Claude', 'ChatGPT', 'Cursor', 'Gemini', 'Copilot', 'Codex']) assert.ok(!text.includes(name), name);
});
