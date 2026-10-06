/**
 * Offline tests for the copy-quality wave of 2026-10-05 (D-238 to D-249).
 * No model calls: the writer and Jev are stubs, pages are fixtures, and the
 * database writes are recorders. The caption fixtures are the real artifacts
 * that reached Instagram on Sep 30 and Oct 3.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { buildCopyTaskBlock, copyStrategySystem } from '@/lib/reels/copy/assemble';
import {
  captionBodyArtifacts,
  postableCaption,
  repairModelText,
  stripCaptionTail,
  textArtifacts,
} from '@/lib/reels/copy/clean-text';
import { holdOutReasons, storyUrlKey } from '@/lib/reels/copy/held-out';
import {
  REPORT_COPY_TOOL,
  TEXT_ARTIFACT_ERROR,
  fullCaption,
  isTextArtifactError,
  parseCopyReport,
  publishCopy,
} from '@/lib/reels/copy/report';
import { COPY_PROMPT_VERSION, COPY_SKILL, FRAMEWORK_WRITING_LOGIC } from '@/lib/reels/copy/skill';
import { BUCKET_SPEC_TEXT } from '@/lib/reels/copy/source-text.generated';
import type { CopyTarget, saveIdeaCopy } from '@/lib/reels/copy/store';
import type { CopyClient } from '@/lib/reels/copy/writer';
import { FULL_TEXT_MIN_CHARS } from '@/lib/reels/config';
import type { JevRequest, JevRunner } from '@/lib/reels/jev/runner';
import { looksLikeTeaser, teaserMarker, TEASER_MAX_CHARS } from '@/lib/reels/net/teaser';
import { writeTargetCopy } from '@/lib/reels/pipeline/copy';
import { resolveBody } from '@/lib/reels/pipeline/ingest';

// ── D-246: escape repair and artifacts ─────────────────────────────────────

test('written-out escapes are repaired in one pass', () => {
  assert.equal(repairModelText('One.\\n\\nTwo.'), 'One.\n\nTwo.');
  assert.equal(repairModelText('In her words, \\"mass surveillance.\\"'), 'In her words, "mass surveillance."');
  assert.equal(repairModelText('It\\u2019s here'), 'It’s here');
  assert.equal(repairModelText('A\\r\\nB\r\nC'), 'A\nB\nC');
  assert.equal(repairModelText('tab\\there'), 'tab here');
  assert.equal(repairModelText('a \\\\n b'), 'a \\n b', 'an escaped backslash is read once');
  assert.equal(repairModelText('Plain text, "quoted", no escapes.'), 'Plain text, "quoted", no escapes.');
});

test('the Sep 30 and Oct 3 posted captions are repaired and pass the posting gate', () => {
  const sep30 =
    'Two AI companies spent the summer trying to shape how you feel about AI. Cal Newport says it backfired.\\n\\nHere is the run of events, per his blog post.';
  const oct3 =
    'Flock is different, she wrote. In her words, \\"a type of indiscriminate mass surveillance.\\"\n\nThat includes your car.';
  for (const caption of [sep30, oct3]) {
    const posted = postableCaption(caption);
    assert.deepEqual(posted.problems, []);
    assert.equal(posted.caption.includes('\\'), false);
  }
  assert.match(postableCaption(sep30).caption, /backfired\.\n\nHere is/);
});

test('leaked tool JSON is named and refused at the posting gate', () => {
  const leaked =
    'Helios is the account that finds tools like this early.", "call_to_action": "Send this to someone.", "hashtags": ["#AI"]';
  assert.ok(textArtifacts(leaked).includes('tool syntax'));
  assert.ok(postableCaption(leaked).problems.includes('tool syntax'));
});

test('a trailing call to action or hashtag line is posted once, even with a label', () => {
  const cta = 'Send this to the friend who drives cross-country.';
  const body = `Story paragraph.\n\nSecond paragraph.\n\nCTA: ${cta}\n\n#AI #Privacy`;
  assert.equal(stripCaptionTail(body, cta, 1), 'Story paragraph.\n\nSecond paragraph.');
  assert.equal(stripCaptionTail('Only.\n\n#AI', cta, 2), 'Only.\n\n#AI', 'parsing keeps two paragraphs');
  assert.deepEqual(captionBodyArtifacts(body, cta), []);
  assert.ok(captionBodyArtifacts(`Story.\n\n${cta}\n\nMore story after it.`, cta).includes('call to action in the caption body'));
  const posted = fullCaption({ caption: body, callToAction: cta, hashtags: ['#AI', '#Privacy'] });
  assert.equal(posted.split(cta).length - 1, 1);
  assert.equal((posted.match(/#AI/g) ?? []).length, 1);
});

function reportInput(caption: string, extra: Record<string, unknown> = {}) {
  return {
    hook_drafts: ['a', 'b', 'c'],
    copy_draft: 'draft',
    caption_draft: 'draft',
    remaining_patterns: [],
    viewer_stake: 'Your passwords could be open to anyone.',
    tension: 'A deputy chased plates and a judge threw the case out.',
    on_screen_copies: ['Strong line one here', 'Strong line two here'],
    caption,
    call_to_action: 'Send this to the friend who built an app.',
    outcome_note: '',
    hashtags: ['#AI', '#Security', '#Apps'],
    sources: [],
    ...extra,
  };
}

test('parseCopyReport repairs escaped quotes and keeps the outcome note', () => {
  const call = parseCopyReport(
    reportInput('She called it \\"mass surveillance.\\"\\n\\nThe ruling stands for now.', {
      outcome_note: 'The judge threw out the evidence, and the copy lands there.',
    }),
  );
  assert.equal(call.caption, 'She called it "mass surveillance."\n\nThe ruling stands for now.');
  assert.equal(call.working.outcomeNote, 'The judge threw out the evidence, and the copy lands there.');
});

test('a report that still carries tool syntax fails with the artifact error', () => {
  assert.throws(
    () => parseCopyReport(reportInput('Story.\n\nMore.", "call_to_action": "Send this."')),
    (error: Error) => error.message.startsWith(TEXT_ARTIFACT_ERROR) && isTextArtifactError(error.message),
  );
  assert.equal(isTextArtifactError('report_copy caption is one block.'), false);
});

test('the report tool asks for an outcome note and keeps it required under strict', () => {
  assert.ok('outcome_note' in REPORT_COPY_TOOL.input_schema.properties);
  assert.ok(REPORT_COPY_TOOL.input_schema.required.includes('outcome_note'));
  assert.match(REPORT_COPY_TOOL.input_schema.properties.viewer_stake.description, /hook questions before either copy is drafted/);
  assert.match(REPORT_COPY_TOOL.input_schema.properties.call_to_action.description, /something this story is about/);
});

// ── D-246: one retry when the writer's text still carries an artifact ────────

function stubJev(answer: (request: JevRequest<Questions>) => Record<string, unknown>): JevRunner {
  return {
    callCount: 0,
    async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
      return {
        model: 'jev-test',
        answers: answer(request as JevRequest<Questions>),
        usage: { input_tokens: 80, output_tokens: 10 },
      } as unknown as SystemOneResult<Q>;
    },
  };
}

const passingJev = stubJev((request) => {
  if (request.sets[0]?.id === 'copy-story-match') return { sameStory: { type: 'noul', noul: 0.9 } };
  if (request.sets[0]?.id === 'full-story-cue') return { readsWell: { type: 'noul', noul: 0.8 } };
  const score = { type: 'score', score: 3.5, confidence: 0.8, probabilities: {}, legend: {} };
  return { plain: score, stake: score, loop: score, care: score, reward: score };
});

function scriptedClient(replies: unknown[], seen: Anthropic.MessageCreateParamsNonStreaming[]): CopyClient {
  return {
    messages: {
      async create(params) {
        seen.push(params);
        return {
          id: `msg_${seen.length}`,
          type: 'message',
          role: 'assistant',
          model: params.model,
          content: [{ type: 'tool_use', id: `t${seen.length}`, name: 'report_copy', input: replies[seen.length - 1] }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        } as unknown as Anthropic.Message;
      },
    },
  };
}

function target(overrides: Partial<CopyTarget> = {}): CopyTarget {
  return {
    postIdeaId: 'idea-1',
    rank: 1,
    bucket: 'the_number',
    framework: 'arousal',
    members: [
      {
        role: 'primary',
        sourceName: 'TechCrunch',
        headline: 'Databases exposed',
        body: 'Body text.',
        url: 'https://techcrunch.com/2026/10/01/databases-exposed',
        citationUrls: [],
        author: null,
        byline: null,
        publishTime: null,
      },
    ],
    ...overrides,
  };
}

test('a draft call whose report still carries tool syntax is retried once, and both calls are billed', async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const leaked = reportInput('Story.\n\nMore.", "hashtags": ["#AI"]');
  const clean = reportInput('Story.\n\nMore.');
  const client = scriptedClient([leaked, clean, clean], sent);
  const costs: string[] = [];
  const saved: Array<Parameters<typeof saveIdeaCopy>[0]> = [];
  const outcome = await writeTargetCopy(client, 'run-1', 'slate-1', target(), {
    jev: passingJev,
    save: async (row) => {
      saved.push(row);
      return true;
    },
    cost: async (row) => {
      costs.push(row.component);
    },
  });
  assert.equal(sent.length, 3, 'two draft calls plus one retry');
  assert.deepEqual(costs, ['copy-caption', 'copy-caption', 'copy-caption']);
  assert.equal(outcome.ok, true);
  assert.equal(saved.at(-1)?.checks?.textArtifacts.length, 0);
});

// ── D-242: a returning idea sees its earlier copies ─────────────────────────

test('earlier copies go into the uncached task block only when the idea returns', async () => {
  const base = { bucket: 'the_number' as const, framework: 'arousal' as const, members: [] };
  const fresh = buildCopyTaskBlock(base);
  assert.doesNotMatch(fresh, /earlier night/);
  const returning = buildCopyTaskBlock({
    ...base,
    earlierLines: [{ nyDate: '2026-10-04', onScreenCopy: 'An AI won\n14 of 14.', plain: 0.5, stake: 0.23 }],
  });
  assert.match(returning, /earlier night, and no copy cleared the bar/);
  assert.match(returning, /Copy 1, from 2026-10-04: "An AI won \/ 14 of 14\." Plain 0\.50\. Stake 0\.23\./);
  assert.match(returning, /Do not edit them or reuse their first lines/);

  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const clean = reportInput('Story.\n\nMore.');
  await writeTargetCopy(
    scriptedClient([clean, clean], sent),
    'run-1',
    'slate-1',
    target({ earlierLines: [{ nyDate: '2026-10-04', onScreenCopy: 'Old line', plain: 0.5, stake: 0.2 }] }),
    { jev: passingJev, save: async () => true, cost: async () => {} },
  );
  const user = sent[0].messages[0].content as Anthropic.TextBlockParam[];
  assert.doesNotMatch(user[0].text, /Old line/, 'the cached sources block does not change');
  assert.match(user[1].text, /Old line/);
  assert.equal(JSON.stringify(sent[0].system).includes('Old line'), false);
});

// ── D-238 to D-244, D-249: wording lives where it should ───────────────────

test('the v17 tests stay in copy-caption-v18 and the precedence order is unchanged', () => {
  assert.equal(COPY_PROMPT_VERSION, 'copy-caption-v27');
  assert.match(COPY_SKILL, /2\. The bucket's other rules: its caption structure, its resolution, and any guardrail\./);
  assert.match(COPY_SKILL, /5\. Everything else in this skill\./);
  assert.doesNotMatch(COPY_SKILL, /Apply the framework's hook formulas/);
  assert.match(COPY_SKILL, /or none of them/);
  assert.match(COPY_SKILL, /5\. In The Saga, where does the copy land\?/);
  assert.match(COPY_SKILL, /It does not rank stories/);
  assert.match(COPY_SKILL, /A second figure, a before and after, a ranking, or a contest between two systems/);
  assert.match(COPY_SKILL, /If the same sentence would fit most posts about AI, it is not the stake yet/);
  assert.match(COPY_SKILL, /does not ask for a labelled paragraph per part/);
  assert.match(COPY_SKILL, /or the framework's writing logic sends the close to Helios/);
  assert.match(COPY_SKILL, /There is no pitch and no offer of Helios services/);
  assert.doesNotMatch(FRAMEWORK_WRITING_LOGIC.arousal.onScreen, /address the viewer and name what they stand to lose/);
  assert.doesNotMatch(FRAMEWORK_WRITING_LOGIC.arousal.onScreen, /The fact does the work/);
  assert.match(FRAMEWORK_WRITING_LOGIC.arousal.onScreen, /Where the source reports that cost landing on someone, show it landing/);
  assert.match(FRAMEWORK_WRITING_LOGIC.arousal.caption, /could end a caption about a different story/);
  assert.match(FRAMEWORK_WRITING_LOGIC.arousal.caption, /ask to follow Helios for the next story like this one/);
});

test('the bucket rules carry the tests, and The Number has three example shapes', () => {
  assert.match(BUCKET_SPEC_TEXT.the_saga.body, /Where the sources report an outcome that already happened, the second beat lands on it/);
  assert.match(BUCKET_SPEC_TEXT.the_number.body, /A second figure, a ranking, or a comparison is more of the statistic, not an implication/);
  assert.match(BUCKET_SPEC_TEXT.the_number.body, /each placed where the story needs it/);
  assert.doesNotMatch(BUCKET_SPEC_TEXT.the_number.body, /The AI is rarely why/);
  const examples = BUCKET_SPEC_TEXT.the_number.body.match(/"[^"]+"/g) ?? [];
  assert.equal(examples.length, 3);
  for (const example of examples) assert.ok(example.split(/\s+/).length <= 22, example);
  assert.match(copyStrategySystem('the_number', 'arousal'), /A support bot promised 2,000 customers/);
});

// ── D-245: teasers ─────────────────────────────────────────────────────────

const ARS_TEASER =
  'Anthropic spent almost a third of its investor filing on risks, according to people familiar with the filing, ' +
  'with close to a quarter of revenue last year coming from just two clients. Read full article Comments';

test('a feed teaser is recognized, and a long article with a closing link is not', () => {
  assert.equal(teaserMarker(ARS_TEASER), 'read full article');
  assert.equal(looksLikeTeaser('This post is for paid subscribers. Subscribe to read the rest.'), true);
  const article = `${'A full paragraph of the story. '.repeat(120)}Continue reading: the next story.`;
  assert.ok(article.length > TEASER_MAX_CHARS);
  assert.equal(looksLikeTeaser(article), false);
  assert.equal(looksLikeTeaser('We propose a method for tabular prediction that needs no tuning. Results on 14 datasets.'), false);
  assert.equal(FULL_TEXT_MIN_CHARS, 800);
});

const noJev = {} as JevRunner;

test('a teaser is followed to the full article and kept when the page is whole', async () => {
  const page = `<html><body><article>${'<p>The full article keeps going with real reporting. </p>'.repeat(40)}</article></body></html>`;
  const resolved = await resolveBody(
    { canonicalUrl: 'https://arstechnica.com/ai/x', headline: 'x', body: ARS_TEASER, textIsComplete: false, destinationUrl: 'https://arstechnica.com/ai/x' },
    { jev: noJev, fetchPage: async () => ({ html: page, finalUrl: 'https://arstechnica.com/ai/x' }) },
  );
  assert.equal(resolved.dropReason, null);
  assert.ok(resolved.body.length >= FULL_TEXT_MIN_CHARS);
});

test('a teaser whose full article cannot be read is dropped as a teaser', async () => {
  const short = '<html><body><article><p>Only a stub here.</p></article></body></html>';
  const gated = `<html><body><article><p>${'Preview text. '.repeat(70)}</p><p>This post is for paid subscribers.</p></article></body></html>`;
  for (const html of [short, gated]) {
    const resolved = await resolveBody(
      { canonicalUrl: 'https://arstechnica.com/ai/x', headline: 'x', body: ARS_TEASER, textIsComplete: false },
      { jev: noJev, fetchPage: async () => ({ html, finalUrl: 'https://arstechnica.com/ai/x' }) },
    );
    assert.equal(resolved.dropReason, 'teaser');
  }
});

// ── D-247 and D-245: ideas held out of the slots ───────────────────────────

test('a story already published is held out by idea or by any shared URL, and site roots never match', () => {
  const published = {
    ideaIds: new Set(['shipped-idea']),
    urls: new Set([storyUrlKey('https://blog.faav.net/how-i-couldve-accessed-17-trillion-microsoft-records')!]),
  };
  const sameIdea = target({ postIdeaId: 'shipped-idea' });
  const citesIt = target({
    postIdeaId: 'web-search-idea',
    members: [
      {
        ...target().members[0],
        url: 'https://heliosgroup.tech/reels/story/16-year-old',
        citationUrls: ['https://www.blog.faav.net/how-i-couldve-accessed-17-trillion-microsoft-records/?utm_source=x'],
      },
    ],
  });
  const rootOnly = target({
    postIdeaId: 'root-idea',
    members: [{ ...target().members[0], url: 'https://techcrunch.com/', citationUrls: ['https://blog.faav.net/'] }],
  });
  const fresh = target({ postIdeaId: 'fresh-idea' });
  const reasons = holdOutReasons([sameIdea, citesIt, rootOnly, fresh], published);
  assert.equal(reasons.get('shipped-idea'), 'already_published');
  assert.equal(reasons.get('web-search-idea'), 'published_url');
  assert.equal(reasons.has('root-idea'), false);
  assert.equal(reasons.has('fresh-idea'), false);
  assert.equal(storyUrlKey('https://techcrunch.com/'), null);
});

test('an idea built only from teasers is held out; one real member keeps it in', () => {
  const teaserMember = { ...target().members[0], body: ARS_TEASER };
  const onlyTeasers = target({ postIdeaId: 'teaser-idea', members: [teaserMember] });
  const mixed = target({ postIdeaId: 'mixed-idea', members: [teaserMember, target().members[0]] });
  const reasons = holdOutReasons([onlyTeasers, mixed], { ideaIds: new Set(), urls: new Set() });
  assert.equal(reasons.get('teaser-idea'), 'teaser_only');
  assert.equal(reasons.has('mixed-idea'), false);
});

test('the posted caption comes from a clean report unchanged', () => {
  const call = parseCopyReport(reportInput('Story.\n\nMore.'));
  const posted = postableCaption(fullCaption(publishCopy(call, 'Strong line one here')));
  assert.deepEqual(posted.problems, []);
  assert.match(posted.caption, /^Story\.\n\nMore\.\n\nSend this to the friend who built an app\.\n\n#AI #Security #Apps$/);
});
