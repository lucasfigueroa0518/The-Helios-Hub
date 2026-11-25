import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TipNotes } from '@/components/field-notes/TipNotes';
import { buildFieldNotesCaption } from '@/lib/field-notes/caption';
import { fieldNotesTipNotes } from '@/lib/social-hub/adapters/field-notes';
import { FIELD_NOTES_PHOTOS_HREF } from '@/lib/social-hub/links';
import { FIELD_NOTES_POSTS_SQL } from '@/lib/social-hub/queries/field-notes';

// The components compile with the classic JSX runtime under tsx, so React must be global.
(globalThis as { React?: unknown }).React = React;

/** Offline: no database, no model. UI-REWORK-CONTRACT C1 (link) and C5 (tip notes). */

const tip = (id: string, subject: string, tags: { leaf?: string | null; want?: string | null; tier?: string | null } = {}) => ({
  tip_id: id, subject, source_url: null, source_label: null, leaf: null, want: null, tier: null, ...tags,
});

test('the Photos link opens the Photo Bank Field Notes section', () => {
  assert.equal(FIELD_NOTES_PHOTOS_HREF, '/social/content/library/photos?section=field-notes');
});

test('the posts query reads each tip\'s leaf, want and tier', () => {
  for (const key of ['leaf', 'want', 'tier']) assert.ok(FIELD_NOTES_POSTS_SQL.includes(`'${key}', pt.${key}`), key);
});

test('two tips and two how-to-try lines make two tip notes, in order, with plain labels', () => {
  const caption = buildFieldNotesCaption([
    { name: 'Claude Code /review', tryIt: 'Type `/review` in a repo.' },
    { name: 'llm-cli', tryIt: 'Run `pip install llm`.' },
  ], 'slug-1');
  const notes = fieldNotesTipNotes({
    caption,
    tips: [
      tip('a', 'Review in one command', { leaf: 'coding_agent_feature', want: 'faster', tier: 'middle' }),
      tip('b', 'A model in your terminal', { leaf: 'repo_free_alternative', want: 'cheaper', tier: 'higher' }),
    ],
  });
  assert.deepEqual(notes, [
    { subject: 'Review in one command', kind: 'Coding agent feature', want: 'Faster', knowHow: 'Middle know-how', name: 'Claude Code /review', tryIt: 'Type /review in a repo.' },
    { subject: 'A model in your terminal', kind: 'Free alternative to a paid tool', want: 'Cheaper', knowHow: 'Higher know-how', name: 'llm-cli', tryIt: 'Run pip install llm.' },
  ]);
});

test('untagged or unknown tags read as null; an old caption gives no name or tryIt; no tips gives nothing', () => {
  const notes = fieldNotesTipNotes({ caption: 'An older caption with no how-to-try lines.', tips: [tip('a', 'Old tip', { leaf: 'not_a_leaf' })] });
  assert.deepEqual(notes, [{ subject: 'Old tip', kind: null, want: null, knowHow: null, name: null, tryIt: null }]);
  assert.deepEqual(fieldNotesTipNotes({ caption: null, tips: [] }), []);
});

test('TipNotes: bold name, ": ", how to try it, three chips; "not tagged" when null; nothing for no tips', () => {
  const html = renderToStaticMarkup(React.createElement(TipNotes, {
    notes: [
      { subject: 's', kind: 'Agent skill', want: 'Better', knowHow: 'Middle know-how', name: 'Skill X', tryIt: 'Add it to your project.' },
      { subject: 's2', kind: null, want: null, knowHow: null, name: 'Tool Y', tryIt: 'Open it.' },
    ],
  }));
  assert.match(html, /<strong>Skill X<\/strong>: <span>Add it to your project\.<\/span>/);
  for (const label of ['Agent skill', 'Better', 'Middle know-how', 'Kind not tagged', 'Want not tagged', 'Know-how not tagged']) assert.ok(html.includes(label), label);
  assert.equal(renderToStaticMarkup(React.createElement(TipNotes, { notes: [] })), '');
});
