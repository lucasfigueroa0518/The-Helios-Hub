/**
 * Helios Social rebuild — prompt text guards (offline, no model).
 *
 * Prompts come from docs/superpowers/specs/2026-10-04-helios-social-prompts.md
 * unchanged; the shared blocks from the reviewed shared-blocks file. These
 * tests fail if the code drifts from either.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { RULES_BLOCK, TESTED_WRITER_RULES, renderRulesFor } from '@/lib/social/prompts/rules-block';
import { VOICE_BLOCK } from '@/lib/social/prompts/voice-block';

const PROMPTS = readFileSync('docs/superpowers/specs/2026-10-04-helios-social-prompts.md', 'utf8');
const BLOCKS = readFileSync('docs/superpowers/specs/2026-10-04-helios-social-shared-blocks.md', 'utf8');

/** Fenced code blocks of a markdown section, in order. */
function codeBlocks(md: string, fromHeading: string): string[] {
  const section = md.slice(md.indexOf(fromHeading));
  return [...section.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
}

test('RULES_BLOCK carries the tested Writer rules word for word', () => {
  const writer = codeBlocks(PROMPTS, '## 2. Writer')[0]!;
  const tested = writer.match(/RULES\n([\s\S]*?)\n\nOUTPUT/)![1];
  assert.equal(TESTED_WRITER_RULES, tested);
  assert.ok(RULES_BLOCK.includes(TESTED_WRITER_RULES));
});

test('VOICE_BLOCK matches the reviewed text byte for byte', () => {
  assert.equal(VOICE_BLOCK, codeBlocks(BLOCKS, '## 1. VOICE_BLOCK')[0]);
});

test("RULES_BLOCK applies Tommy's review decisions (a)-(c)", () => {
  assert.ok(!RULES_BLOCK.includes('—'), 'no em dashes (c)');
  assert.ok(!/TWO background slides|more than two background slides|Two is the ceiling/.test(RULES_BLOCK), 'count trimmed from Context policy (a)');
  assert.ok(RULES_BLOCK.includes('Max 2 background slides.'), 'the tested line carries the count');
  assert.ok(RULES_BLOCK.includes('**Background slides** on "why now"'), 'definition kept (a)');
  assert.ok(RULES_BLOCK.includes('The Fact-checker and the caption follow the same policy.'), '(b)');
  assert.ok(RULES_BLOCK.includes('## Glossing (advisory, not required)'));
});

test('renderRulesFor renders nothing until M5 builds it from real checks (f)', () => {
  for (const stage of ['reporter', 'writer', 'editor', 'fact-checker'] as const) assert.equal(renderRulesFor(stage), '');
});
