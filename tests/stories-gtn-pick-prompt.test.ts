/** gtn-pick@1: shape and wording rules. Offline; no model call. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { GTN_PICK, STORIES_PROMPTS } from '@/lib/stories/prompts';

test('gtn-pick@1: the tool asks for the full candidate shape', () => {
  assert.equal(GTN_PICK.id, 'gtn-pick@1');
  assert.equal(GTN_PICK.tool.name, 'submit_candidates');
  assert.ok(STORIES_PROMPTS.includes(GTN_PICK));
  const items = (GTN_PICK.tool.input_schema.properties as any).candidates.items;
  assert.deepEqual(items.required, ['rank', 'origin', 'pool_id', 'question', 'answer', 'label', 'meaning', 'topic', 'source_url', 'source_quote', 'source_verb', 'source_name', 'subjects', 'visual', 'answer_visual']);
  assert.equal(items.additionalProperties, false);
  assert.equal(items.properties.rank.type, 'integer');
  assert.deepEqual(items.properties.origin.enum, ['pool', 'model']);
  assert.deepEqual(items.properties.source_verb.enum, ['via', 'reported by', 'from']);
});

test('gtn-pick@1: rules are in the system prompt', () => {
  for (const re of [/AI/, /web search/i, /never .*memory/i, /quote/i, /three candidates/i, /at least one/i, /announced, released or changed in the last 30 days/i, /<humanizer>/])
    assert.match(GTN_PICK.system, re);
});

test('gtn-pick@1: principles only, no examples', () => {
  const body = GTN_PICK.system.replace(/<humanizer>[\s\S]*<\/humanizer>/, '');
  assert.doesNotMatch(body, /for example|e\.g\.|such as|embedding|first chatbot|end the world/i);
});

test('gtn-pick@1: the system prompt is stable', () => {
  assert.doesNotMatch(GTN_PICK.system, /20\d\d-\d\d-\d\d/);
});
