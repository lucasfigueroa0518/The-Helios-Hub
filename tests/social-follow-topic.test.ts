/**
 * The follow slide names the kind of story, never the story (Tommy,
 * 2026-10-12): "Follow Helios for more ⟨topic⟩ like this." The Writer picks a
 * short topic; code keeps it only if it is a plain generic phrase that names
 * nothing and promises no follow-up. Anything else falls back to the fixed
 * line. Offline, pure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FOLLOW_LINE, followLine, validFollowTopic } from '@/lib/social/writer/draft';

test('a plain generic topic builds the line', () => {
  for (const [topic, line] of [
    ['AI safety stories', 'Follow Helios for more AI safety stories like this.'],
    ['AI deal news', 'Follow Helios for more AI deal news like this.'],
    ['AI workplace tools', 'Follow Helios for more AI workplace tools like this.'],
    ['AI policy stories', 'Follow Helios for more AI policy stories like this.'],
  ] as const) {
    assert.equal(followLine(topic), line);
  }
});

test('surrounding whitespace is trimmed', () => {
  assert.equal(followLine('  AI policy stories '), 'Follow Helios for more AI policy stories like this.');
});

test('a topic that names a company, person or product falls back', () => {
  for (const t of ['Anthropic safety stories', 'Amazon deal news', 'Trump task forces', 'ChatGPT stories', 'OpenAI news']) {
    assert.equal(followLine(t), FOLLOW_LINE, t);
  }
});

test('a topic that promises follow-up falls back', () => {
  for (const t of ['updates on this story', 'latest AI news', 'AI news as it unfolds', 'ongoing AI stories', 'what happens next', 'developing AI stories', 'stories to keep up with', 'stay tuned for more']) {
    assert.equal(followLine(t.toLowerCase()), FOLLOW_LINE, t);
  }
});

test('a topic that is the wrong shape falls back', () => {
  for (const t of ['', '   ', 'stories', 'a very long winded topic that goes on and on', 'AI safety stories.', 'AI safety, deals', 'AI stories like this', '2026 AI deals']) {
    assert.equal(followLine(t), FOLLOW_LINE, JSON.stringify(t));
  }
  assert.equal(followLine(undefined), FOLLOW_LINE);
  assert.equal(followLine(null as unknown as string), FOLLOW_LINE);
  assert.equal(followLine(42 as unknown as string), FOLLOW_LINE);
});

test('validFollowTopic agrees with followLine', () => {
  assert.equal(validFollowTopic('AI safety stories'), true);
  assert.equal(validFollowTopic('Anthropic stories'), false);
});
