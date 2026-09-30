/**
 * Consistency test for the shared editorial rules block.
 *
 * `lib/social/editorial/v2/rules-block.ts` is the canonical source for
 * the priority ladder, context policy, slide count, photo tiers and
 * glossing rule. Every stage prompt imports it.
 *
 * This test fails if any prompt string contains a phrase that's been
 * retired — a stale copy of an old rule that would drift out of sync.
 * The retired list lives in the block itself; when a rule is retired,
 * add its phrase to RETIRED_PHRASES and never remove it.
 *
 * The test also fails if any of the five stage prompts stops embedding
 * the shared rules block.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { RULES_BLOCK, RETIRED_PHRASES } from '@/lib/social/editorial/v2/rules-block';
import { REPORTER_PROMPT } from '@/lib/social/editorial/v2/prompts/reporter';
import { WRITER_PROMPT } from '@/lib/social/editorial/v2/prompts/writer';
import { EDITOR_PROMPT } from '@/lib/social/editorial/v2/prompts/editor';
import { CAPTION_PROMPT } from '@/lib/social/editorial/v2/prompts/caption';
import { FACT_CHECKER_PROMPT } from '@/lib/social/editorial/v2/prompts/fact-checker';

const STAGES: Array<{ name: string; prompt: string }> = [
  { name: 'reporter', prompt: REPORTER_PROMPT },
  { name: 'writer', prompt: WRITER_PROMPT },
  { name: 'editor', prompt: EDITOR_PROMPT },
  { name: 'caption', prompt: CAPTION_PROMPT },
  { name: 'fact-checker', prompt: FACT_CHECKER_PROMPT },
];

describe('editorial rules consistency', () => {
  test('every stage prompt embeds the shared rules block', () => {
    const marker = 'Priority ladder (use this to resolve any conflict)';
    assert.ok(RULES_BLOCK.includes(marker), 'RULES_BLOCK is missing its own marker sentence');
    for (const { name, prompt } of STAGES) {
      assert.ok(
        prompt.includes(marker),
        `${name} prompt is missing the shared rules block (looked for "${marker}")`,
      );
    }
  });

  test('no stage prompt contains a retired phrase', () => {
    const failures: string[] = [];
    for (const { name, prompt } of STAGES) {
      for (const phrase of RETIRED_PHRASES) {
        if (prompt.includes(phrase)) failures.push(`${name}: "${phrase}"`);
      }
    }
    assert.deepEqual(
      failures,
      [],
      `retired phrases found in prompts:\n  ${failures.join('\n  ')}`,
    );
  });

  test('RETIRED_PHRASES is frozen (accidental mutation throws)', () => {
    assert.throws(() => {
      (RETIRED_PHRASES as unknown as string[]).push('mutable-attempt');
    });
  });
});
