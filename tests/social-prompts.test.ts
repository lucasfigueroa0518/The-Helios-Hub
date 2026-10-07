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

import { IMAGE_RULE, RULES_BLOCK, TESTED_IMAGE_RULE, TESTED_WRITER_RULES, WRITER_RULES, renderRulesFor } from '@/lib/social/prompts/rules-block';
import { REPORTER_SYSTEM, reporterUserMessage } from '@/lib/social/reporter/prompt';
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
  // Photo rule (2026-10-06): the tested IMAGE line is replaced, word for word from the prompts file.
  const imageRule = codeBlocks(PROMPTS, '**Photo rule (Tommy, 2026-10-06)')[0]!;
  assert.equal(IMAGE_RULE, imageRule);
  assert.ok(TESTED_WRITER_RULES.includes(TESTED_IMAGE_RULE));
  assert.equal(WRITER_RULES, TESTED_WRITER_RULES.replace(TESTED_IMAGE_RULE, IMAGE_RULE));
  assert.ok(RULES_BLOCK.includes(WRITER_RULES) && !RULES_BLOCK.includes('symbolic'));
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

test('renderRulesFor: the Writer and Editor are told the M7 checks C1–C5 (f); other stages get nothing', () => {
  for (const stage of ['writer', 'editor'] as const) {
    const r = renderRulesFor(stage);
    for (const s of ['headline ≤60', 'body ≤220', 'Quotation marks only', 'banned words', 'No hashtags', 'At most 2 background slides']) assert.ok(r.includes(s), `${stage}: ${s}`);
  }
  for (const stage of ['reporter', 'fact-checker'] as const) assert.equal(renderRulesFor(stage), '');
});

// ── Reporter prompt (prompts file §1, tested text + marked edits) ──────


test('Reporter prompt = tested text, STORY line moved to the user message, plus the three listed additions', () => {
  const tested = codeBlocks(PROMPTS, '## 1. Reporter')[0]!;
  const storyLine = 'STORY: {{story one-liner from selection}}. Starting sources: {{member article URLs from the Jev group}}. Today is {{date}}.';
  assert.ok(tested.includes(storyLine));
  const expected = tested
    // PLACEMENT: the per-story line goes to the user message (prompt caching).
    .replace(`\n\n${storyLine}`, '')
    // [A1] raw-text page reader.
    .replace('Spend at most ~12 tool calls.', 'Spend at most ~12 tool calls. Open pages with read_page: it returns the page\'s raw text and its photos with caption and credit lines.')
    // [A3] cut-off quotes.
    .replace('Mark any quote found in only ONE source with ⚠.\n', 'Mark any quote found in only ONE source with ⚠.\n- If a quote is cut off in every source, mark it [cut off].\n')
    .replace('[⚠ if single source]', '[⚠ if single source] [cut off if cut off in every source]')
    // OUTPUT (2026-10-05): structured output via submit_brief; section list unchanged.
    .replace('OUTPUT (plain text, exactly these sections):', "When you're done, call submit_brief with these sections:")
    // v2 (2026-10-05): primary source, aggregators, stay on the main event.
    .replace('named experts). Prefer original reporting; no aggregators.', 'named experts). Find and open the primary source: the original essay, interview, announcement, filing or support page the story is about. Search for it if it isn\'t among the starting sources. If you can\'t open it, say why under NOT ANSWERED. Prefer original reporting.')
    .replace('copy caption and credit line exactly.\n', 'copy caption and credit line exactly.\n- Aggregators are outlets that summarize other outlets\' reporting, including AI-generated summary sites. Use them only to find the original. Never use an aggregator as the only source for a fact or quote.\n- Stay on the main event. FACTS cover only this story. Earlier or related events go in BACKGROUND (max 2), and only if a reader needs them to understand the news. Leave everything else out.\n')
    // [A2] NUMBERS with a type (format approved 2026-10-04).
    .replace('NUMBERS: N1 value | what it counts | source', 'NUMBERS: N1: value | type | what it counts | source (type is one of: money, count, percent, duration, date, other; value exactly as the source writes it)')
    // Quote speakers by ID (2026-10-06).
    .replace('[cut off if cut off in every source]', "[cut off if cut off in every source] — speaker's SUBJECTS ID (S1…), or none")
    .replace('SUBJECTS: people/companies/products in the story (with role)', 'SUBJECTS: S1, S2, … people/companies/products in the story (with role)');
  assert.equal(REPORTER_SYSTEM, expected);
  assert.equal(
    reporterUserMessage({ story: 'Trump unveils his new Super Intelligence Force', startingSources: ['https://a.example/1', 'https://b.example/2'], today: 'October 4, 2026' }),
    'STORY: Trump unveils his new Super Intelligence Force. Starting sources: https://a.example/1, https://b.example/2. Today is October 4, 2026.',
  );
});
