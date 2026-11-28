/**
 * Targeted Revisions: the box's per-type hints (lib/revisions/box-hints.ts) stay in step with what each
 * type's description can actually do. Offline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { BOX_HINTS, MADE_TOGETHER, canChangeText } from '@/lib/revisions/box-hints';
import { VERTICAL_LABELS } from '@/lib/revisions/labels';
import { descriptionFor } from '@/lib/revisions/registry';
import type { Vertical } from '@/lib/social-hub/types';

const VERTICALS = Object.keys(VERTICAL_LABELS) as Vertical[];

test('every content type has hints, and the fixes it lists are exactly the ones its description implements', () => {
  for (const v of VERTICALS) {
    const d = descriptionFor(v);
    const listed = BOX_HINTS[v].can.map((c) => c.kind).sort();
    if (!d || MADE_TOGETHER.has(v)) {
      assert.deepEqual(listed, [], `${v}: a type that takes no frame fix lists nothing`);
      continue;
    }
    assert.deepEqual(listed, [...d.fixKinds].sort(), `${v}: the box lists what the type can do`);
    assert.equal(new Set(listed).size, listed.length, `${v}: no fix listed twice`);
  }
});

test('hints are plain words: no code names, a real sample sentence, and "text on screen" instead of "trial reels"', () => {
  for (const v of VERTICALS) {
    const h = BOX_HINTS[v];
    assert.ok(h.example.length > 10 && h.example.length < 80, v);
    assert.doesNotMatch(JSON.stringify(h), /trial|reel|_|photo_log|fixKind/i, `${v}: no internal names in what a person reads`);
  }
});

test('canChangeText reads as a sentence fragment', () => {
  assert.equal(canChangeText('ai_events'), 'a slide’s photo, the title, host or place and a slide’s layout');
  assert.equal(canChangeText('reels'), 'the words on screen, the background image, the video’s movement and the color grade');
});
