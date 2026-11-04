/** One-box seeding: prompts, tool schemas and the approval gate (offline, pure). */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ONE_BOX_SEED_PROMPT_VERSION,
  ONE_BOX_SYSTEM,
  ONE_BOX_VERIFY_PROMPT_VERSION,
  REPORT_FINDING_TOOL,
  VERDICT_TOOL,
  VERIFY_SYSTEM,
  buildSearchUserTurn,
  buildVerifyUserTurn,
  oneBoxApproved,
} from '@/lib/seed/one-box/prompts';

test('system and tool text do not change with the type, the blurb or the pool', () => {
  const before = JSON.stringify([ONE_BOX_SYSTEM, REPORT_FINDING_TOOL, VERIFY_SYSTEM, VERDICT_TOOL]);
  const a = buildSearchUserTurn({ vertical: 'reels', blurb: 'BLURB-ALPHA', poolHeadlines: ['HEADLINE-ONE'] });
  const b = buildSearchUserTurn({ vertical: 'explainers', blurb: 'AI hallucinations', poolHeadlines: [] });
  assert.notEqual(a, b);
  assert.equal(JSON.stringify([ONE_BOX_SYSTEM, REPORT_FINDING_TOOL, VERIFY_SYSTEM, VERDICT_TOOL]), before);
});

test('the blurb, link hint and pool headlines appear only in the user turn', () => {
  const turn = buildSearchUserTurn({
    vertical: 'stories', series: 'guess_the_number', blurb: 'BLURB-ALPHA', poolHeadlines: ['HEADLINE-ONE'],
    linkHint: { url: 'https://x.test/a', headline: 'HINT-HEADLINE', excerpt: 'HINT-EXCERPT' },
  });
  for (const needle of ['BLURB-ALPHA', 'HEADLINE-ONE', 'HINT-HEADLINE', 'HINT-EXCERPT', 'https://x.test/a']) {
    assert.ok(turn.includes(needle), needle);
    assert.ok(!ONE_BOX_SYSTEM.includes(needle) && !JSON.stringify(REPORT_FINDING_TOOL).includes(needle), `${needle} leaked into the cached prefix`);
  }
});

test('an unreadable link is described as such in the user turn', () => {
  const turn = buildSearchUserTurn({ vertical: 'reels', blurb: 'b', poolHeadlines: [], linkHint: { url: 'https://x.test/a', unreadable: true } });
  assert.match(turn, /could not be read/i);
});

test('buildVerifyUserTurn clips the page text to 3000 characters', () => {
  const turn = buildVerifyUserTurn({ vertical: 'reels', blurb: 'b', pageText: 'x'.repeat(10_000) });
  assert.ok(!turn.includes('x'.repeat(3001)));
  assert.ok(turn.includes('x'.repeat(3000)));
});

test('the report tool allows at most three entries, with only the pools’ existing field names', () => {
  const props = REPORT_FINDING_TOOL.input_schema.properties as Record<string, { maxItems?: number; items?: { properties: Record<string, unknown> } }>;
  assert.equal(props.entries?.maxItems, 3);
  assert.deepEqual(Object.keys(props.entries!.items!.properties).sort(), ['description', 'fact', 'headline', 'sourceUrl', 'storyHeadline', 'title', 'toolName', 'url', 'value']);
});

test('the system prompt names each pool’s exact input fields', () => {
  for (const line of ['Text on Screen (reels): headline, url', 'Carousels: url, headline', 'Last Few Days (last_few_days): url, headline', 'Guess the Number: value, fact, url (optionally storyHeadline)', 'Free vs. Paid: toolName, url (optionally description)', 'Explainers: title, sourceUrl']) {
    assert.ok(ONE_BOX_SYSTEM.includes(line), line);
  }
});

test('both prompt versions are drafts and the gate needs the exact env value', () => {
  assert.match(ONE_BOX_SEED_PROMPT_VERSION, /-draft$/);
  assert.match(ONE_BOX_VERIFY_PROMPT_VERSION, /-draft$/);
  const saved = process.env.ONE_BOX_SEED_PROMPT_APPROVED;
  try {
    delete process.env.ONE_BOX_SEED_PROMPT_APPROVED;
    assert.equal(oneBoxApproved(), false);
    process.env.ONE_BOX_SEED_PROMPT_APPROVED = 'yes';
    assert.equal(oneBoxApproved(), false);
    process.env.ONE_BOX_SEED_PROMPT_APPROVED = 'true';
    assert.equal(oneBoxApproved(), true);
  } finally {
    if (saved === undefined) delete process.env.ONE_BOX_SEED_PROMPT_APPROVED; else process.env.ONE_BOX_SEED_PROMPT_APPROVED = saved;
  }
});
