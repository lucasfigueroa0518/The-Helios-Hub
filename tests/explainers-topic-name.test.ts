import assert from 'node:assert/strict';
import { test } from 'node:test';

import { explainerIdeas, topicName } from '@/lib/social-hub/adapters/explainers';
import type { ExplainerTopicRow } from '@/lib/social-hub/queries/explainers';

test('idea pool: an Explainers idea is named by its topic (the term, Title Case), not by its question', () => {
  assert.equal(topicName({ term: 'context window', title: 'What is a context window?' }), 'Context Window');
  assert.equal(topicName({ term: 'RAG', title: 'What does RAG add?' }), 'RAG');
  assert.equal(topicName({ term: 'next-token prediction', title: '' }), 'Next-Token Prediction');
  assert.equal(topicName({ term: 'human-in-the-loop', title: '' }), 'Human-in-the-Loop');
  assert.equal(topicName({ term: 'API pricing per token', title: '' }), 'API Pricing per Token');
  // a topic from before terms keeps its title
  assert.equal(topicName({ term: null, title: 'What is a webhook?' }), 'What is a webhook?');
  const row = { topic_id: 't1', title: 'How does an LLM pick its next word?', term: 'next-token prediction', scope: null, status: 'pool', origin: 'auto', weighted_score: 80, created_at: '2026-11-20', ok_jobs: 0, last_render_at: null, published: false, scheduled: false } as unknown as ExplainerTopicRow;
  assert.equal(explainerIdeas([row])[0]!.title, 'Next-Token Prediction');
});

test('the hub lists curriculum ideas in teaching order, not by score; made ideas still lead', async () => {
  const { poolLead, queueOrder } = await import('@/lib/social-hub/queue');
  const idea = (id: string, score: number, curriculumRank: number | null, hasContent = false) => ({ id, score, curriculumRank, hasContent, state: hasContent ? 'content_ready' : 'idea_only' });
  const ideas = [idea('deep', 95, 300), idea('basics', 40, 2), idea('off', 99, null), idea('mid', 70, 120), idea('made', 10, 390, true)];
  assert.deepEqual(queueOrder(ideas, [], poolLead(ideas)).map((q) => q.item.id), ['made', 'basics', 'mid', 'deep', 'off']);
});
