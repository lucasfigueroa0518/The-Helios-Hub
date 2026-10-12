/**
 * A feed item's body text. Atom feeds (Simon Willison's) carry it in
 * `summary`; reading only content fields dropped every one of his posts as
 * "no body" for weeks. Offline: plain objects, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { bodyOf } from '@/lib/social/ingest/fetch-feeds';

test('an Atom item with only a summary still has a body', () => {
  assert.equal(bodyOf({ summary: '<p>Python 3.15 is out.</p>' }), 'Python 3.15 is out.');
});

test('the fuller content fields still win over the summary', () => {
  assert.equal(bodyOf({ 'content:encoded': '<p>Full text here.</p>', summary: 'Short.' }), 'Full text here.');
  assert.equal(bodyOf({ content: 'Content body.', summary: 'Short.' }), 'Content body.');
  assert.equal(bodyOf({ contentSnippet: 'Snippet body.', summary: 'Short.' }), 'Snippet body.');
});

test('an item with no text anywhere has no body', () => {
  assert.equal(bodyOf({}), '');
  assert.equal(bodyOf({ summary: '   ' }), '');
});
