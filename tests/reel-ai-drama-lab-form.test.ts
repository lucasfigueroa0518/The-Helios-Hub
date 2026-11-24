/** The lab's settings form (HUB-WIRING-CONTRACT.md §7.2): an empty number is an error, never 0; a save is one `{ values }` batch. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CALIBRATION_ESTIMATE, draftOf, ENTER_A_NUMBER, parseNumberField, settingsPayload } from '@/app/reel-ai-drama/lab/form';

test('number fields: empty or junk is "Enter a number", never 0', () => {
  assert.deepEqual(parseNumberField(''), { ok: false, error: ENTER_A_NUMBER });
  assert.deepEqual(parseNumberField('   '), { ok: false, error: ENTER_A_NUMBER });
  assert.deepEqual(parseNumberField('abc'), { ok: false, error: ENTER_A_NUMBER });
  assert.deepEqual(parseNumberField('Infinity'), { ok: false, error: ENTER_A_NUMBER });
  assert.deepEqual(parseNumberField('0'), { ok: true, value: 0 });
  assert.deepEqual(parseNumberField(' 2.5 '), { ok: true, value: 2.5 });
  assert.equal(ENTER_A_NUMBER, 'Enter a number');
});

const saved = { mode: 'development', auto: false, per_reel_cap_usd: 8, daily_render_cap: 2, writer_model: 'claude-x', publishing_live: false };
const editable = ['mode', 'auto', 'per_reel_cap_usd', 'daily_render_cap', 'writer_model'];

test('the batch carries only editable keys that changed, typed like the saved value', () => {
  const drafts = { ...Object.fromEntries(editable.map((k) => [k, draftOf(saved[k as keyof typeof saved])])), publishing_live: true };
  assert.deepEqual(settingsPayload(saved, drafts, editable), { ok: true, values: {} });
  const changed = { ...drafts, auto: true, per_reel_cap_usd: '9.5', writer_model: 'claude-y', daily_render_cap: '2' };
  assert.deepEqual(settingsPayload(saved, changed, editable), { ok: true, values: { auto: true, per_reel_cap_usd: 9.5, writer_model: 'claude-y' } });
});

test('one bad number fails the whole batch with a per-key message and sends nothing', () => {
  const drafts = { per_reel_cap_usd: '', daily_render_cap: '3', auto: true };
  assert.deepEqual(settingsPayload(saved, drafts, editable), { ok: false, fields: { per_reel_cap_usd: ENTER_A_NUMBER } });
});

test('the calibration cost is said once', () => {
  assert.equal(CALIBRATION_ESTIMATE, 'about $0.10–0.30');
});
