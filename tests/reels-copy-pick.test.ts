/**
 * Offline tests for the on-screen copy pick (D-195, D-216). No model calls:
 * Claude and Jev are stubs, and the two database writes are recorders.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

import {
  buildCopyVariants,
  rankCopyLines,
  rewriteLines,
  type CopyLineJudgment,
} from '@/lib/reels/copy/pick';
import type { CopyCall } from '@/lib/reels/copy/report';
import { judgeCopyLine, scoreCopyLine } from '@/lib/reels/copy/score';
import { SAVE_IDEA_COPY_SQL, type CopyTarget, type saveIdeaCopy } from '@/lib/reels/copy/store';
import type { CopyClient } from '@/lib/reels/copy/writer';
import { COPY_PAYOFF, PAYOFF_LEGEND } from '@/lib/reels/jev/questions/copy-payoff';
import { COPY_PICK, copyPickState } from '@/lib/reels/jev/questions/copy-pick';
import {
  COPY_STORY_MATCH,
  captionOpening,
  copyStoryMatchState,
} from '@/lib/reels/jev/questions/copy-story-match';
import type { JevRequest, JevRunner } from '@/lib/reels/jev/runner';
import { writeTargetCopy } from '@/lib/reels/pipeline/copy';

/** Raw Jev levels 0 to 4, a same-story probability, and whether the words fit. */
function judged(
  plain: number,
  stake: number,
  rest: {
    loop?: number;
    care?: number;
    reward?: number;
    sameStory?: number;
    inRange?: boolean;
    payoff?: number | null;
  } = {},
): CopyLineJudgment & { inRange: boolean } {
  return {
    plain,
    stake,
    loop: rest.loop ?? 2,
    care: rest.care ?? 2,
    reward: rest.reward ?? 2,
    sameStory: rest.sameStory ?? 0.9,
    inRange: rest.inRange ?? true,
    payoff: rest.payoff ?? null,
  };
}

function judgment(line: ReturnType<typeof judged>): CopyLineJudgment {
  const { inRange: _inRange, ...rest } = line;
  return rest;
}

function call(caption: string, first: string, second: string): CopyCall {
  return {
    onScreenCopies: [first, second],
    viewerStake: 'Your data could be open to anyone.',
    caption,
    callToAction: 'Save this.',
    hashtags: ['#AI'],
    sources: [],
    working: { hookDrafts: [], copyDraft: '', captionDraft: '', remainingPatterns: [] },
  };
}

// ── The gate ────────────────────────────────────────────────────────────────

test('ball knowledge clears on payoff, and a high plain read cannot stand in for it', () => {
  const { ranked } = rankCopyLines([
    { ...judged(1, 3), payoff: 3 },
    { ...judged(4, 3), payoff: 2 },
  ]);
  assert.deepEqual(
    ranked.map((line) => line.eligible),
    [true, false],
  );
  assert.equal(ranked[0].payoff, 0.75);
  assert.equal(ranked[0].gate, 0.75);
});

test('a line clears the gate only with plain, stake, range, and same story all met', () => {
  const { ranked } = rankCopyLines([
    judged(3, 3),
    judged(2, 4, { loop: 4, care: 4, reward: 4 }),
    judged(4, 2, { loop: 4, care: 4, reward: 4 }),
    judged(4, 4, { inRange: false }),
    judged(4, 4, { sameStory: 0.3 }),
  ]);
  assert.deepEqual(
    ranked.map((line) => line.eligible),
    [true, false, false, false, false],
  );
});

test('eligible lines rank on performance, and ties break on plain, then reward, then order', () => {
  assert.equal(rankCopyLines([judged(3, 3), judged(3, 3, { loop: 4 })]).winner, 1);

  const clearer = rankCopyLines([judged(3, 3), judged(4, 3)]);
  assert.equal(clearer.winner, 1);

  const richer = rankCopyLines([
    judged(4, 4, { loop: 4, care: 2, reward: 0 }),
    judged(4, 4, { loop: 2, care: 2, reward: 2 }),
  ]);
  assert.equal(richer.ranked[0].performance, richer.ranked[1].performance);
  assert.equal(richer.winner, 1);

  assert.equal(rankCopyLines([judged(4, 4), judged(4, 4)]).winner, 0);
});

test('with nothing eligible, the line nearest both bars ships, in-range first', () => {
  // Line 0 is clear but pointless, line 1 compelling but confusing, line 2 the
  // best weaker score. Line 3 is stronger still but over the word range.
  const { winner, eligible, ranked } = rankCopyLines([
    judged(4, 1, { loop: 4, care: 4, reward: 4 }),
    judged(1, 4, { loop: 4, care: 4, reward: 4 }),
    judged(2.8, 2.6),
    judged(2.9, 2.9, { inRange: false }),
  ]);
  assert.equal(eligible, false);
  assert.equal(winner, 2);
  assert.equal(ranked[2].gate, 0.65);
});

test('a same-story miss can still be the nearest miss, since the fallback orders on range and the weaker score', () => {
  const { winner, eligible } = rankCopyLines([judged(2.9, 2.9, { sameStory: 0.1 }), judged(2.5, 2.5)]);
  assert.equal(eligible, false);
  assert.equal(winner, 0);
});

test('an empty slate cannot be ranked', () => {
  assert.throws(() => rankCopyLines([]), /at least one/);
});

// ── Variants ────────────────────────────────────────────────────────────────

test('the winning line keeps the caption from the call that wrote it', () => {
  const first = call('Caption A', 'Line A one', 'Line A two');
  const second = call('Caption B', 'Line B one', 'Line B two');
  const { winner, variants } = buildCopyVariants(
    [
      { call: first, error: null },
      { call: second, error: null },
    ],
    [judgment(judged(4, 4)), judgment(judged(4, 4)), judgment(judged(4, 4, { loop: 4, care: 4, reward: 4 })), judgment(judged(4, 4))],
    'the_number',
  );
  assert.equal(variants.complete, true);
  assert.equal(variants.rewrote, false);
  assert.equal(variants.winnerEligible, true);
  assert.equal(variants.winnerIndex, 2);
  assert.equal(winner?.onScreenCopy, 'Line B one');
  assert.equal(winner?.call.caption, 'Caption B');
  assert.equal(winner?.eligible, true);
  assert.equal(variants.lines.filter((line) => line.winner).length, 1);
  assert.equal(variants.lines[2].viewerStake, 'Your data could be open to anyone.');
  assert.equal(variants.storyQuestionSetVersion, 'copy-story-match-v1');
});

test('the word range comes from the bucket and gates the line', () => {
  const long = Array.from({ length: 16 }, (_, index) => `word${index}`).join(' ');
  const { variants, winner } = buildCopyVariants(
    [{ call: call('Caption', long, 'Short line here'), error: null }],
    [judgment(judged(4, 4, { loop: 4, care: 4, reward: 4 })), judgment(judged(3, 3))],
    'the_number',
  );
  assert.equal(variants.lines[0].inRange, false);
  assert.equal(variants.lines[0].eligible, false);
  assert.equal(winner?.onScreenCopy, 'Short line here');
});

test('one failed call is an incomplete pick among the lines that came back', () => {
  const { winner, variants } = buildCopyVariants(
    [
      { call: null, error: 'Copy request failed: overloaded' },
      { call: call('Caption B', 'Line B one', 'Line B two'), error: null },
    ],
    [judgment(judged(2, 2)), judgment(judged(4, 3, { loop: 3, care: 3, reward: 3 }))],
    'the_number',
  );
  assert.equal(variants.complete, false);
  assert.equal(variants.lines.length, 2);
  assert.equal(winner?.onScreenCopy, 'Line B two');
  assert.equal(winner?.call.caption, 'Caption B');
});

test('the rewrite is shown every judged line with scores on the 0 to 1 scale', () => {
  const { variants } = buildCopyVariants(
    [{ call: call('Caption', 'Line one here', 'Line two here'), error: null }],
    [judgment(judged(2, 1, { sameStory: 0.2 })), judgment(judged(3, 2))],
    'the_number',
  );
  const lines = rewriteLines(variants.lines);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].scores, {
    plain: 0.5,
    stake: 0.25,
    loop: 0.5,
    care: 0.5,
    reward: 0.5,
    payoff: null,
  });
  assert.equal(lines[0].sameStory, false);
  assert.equal(lines[1].sameStory, true);
});

test('a Ball Knowledge pick stores the payoff score and its question version', () => {
  const { variants } = buildCopyVariants(
    [{ call: call('Caption', 'Four free tools replace a twenty dollar app.', 'Line two here now'), error: null }],
    [judgment(judged(1, 3, { payoff: 3 })), judgment(judged(2, 2, { payoff: 1 }))],
    'ball_knowledge',
  );
  assert.equal(variants.payoffQuestionSetVersion, 'copy-payoff-v2');
  assert.equal(variants.lines[0]?.payoff, 0.75);
  assert.equal(variants.winnerIndex, 0);
});

// ── Jev requests ────────────────────────────────────────────────────────────

function stubJev(
  seen: JevRequest<Questions>[],
  answer: (request: JevRequest<Questions>) => Record<string, unknown>,
): JevRunner {
  return {
    callCount: 0,
    async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
      seen.push(request as JevRequest<Questions>);
      return {
        model: 'jev-test',
        answers: answer(request as JevRequest<Questions>),
        usage: { input_tokens: 80, output_tokens: 10 },
      } as unknown as SystemOneResult<Q>;
    },
  };
}

function scoreAnswer(value: number) {
  return { type: 'score', score: value, confidence: 0.8, probabilities: {}, legend: {} };
}

test('Jev scores one line from the on-screen text alone, five scores in one request', async () => {
  const seen: JevRequest<Questions>[] = [];
  const stub = stubJev(seen, () => ({
    plain: scoreAnswer(3),
    stake: scoreAnswer(2),
    loop: scoreAnswer(2),
    care: scoreAnswer(4),
    reward: scoreAnswer(1),
  }));
  const scored = await scoreCopyLine(stub, {
    onScreenCopy: '  Google shut the API overnight.  ',
    postIdeaId: 'idea-1',
    runId: 'run-1',
    bucket: 'the_number',
  });
  assert.deepEqual(scored, { plain: 3, stake: 2, loop: 2, care: 4, reward: 1, payoff: null });
  assert.deepEqual(seen[0]?.state, copyPickState('Google shut the API overnight.'));
  assert.deepEqual(Object.keys(seen[0]?.state ?? {}), ['on_screen_copy']);
  assert.deepEqual(seen[0]?.sets, [COPY_PICK]);
  assert.deepEqual(Object.keys(COPY_PICK.questions), ['plain', 'stake', 'loop', 'care', 'reward']);
  assert.equal(COPY_PICK.version, 'copy-pick-v3');
  assert.equal(seen[0]?.postIdeaId, 'idea-1');
  assert.equal(seen[0]?.runId, 'run-1');
});

test('ball knowledge asks payoff in the same request as the five scores', async () => {
  const seen: JevRequest<Questions>[] = [];
  const stub = stubJev(seen, () => ({
    plain: scoreAnswer(1),
    stake: scoreAnswer(3),
    loop: scoreAnswer(3),
    care: scoreAnswer(3),
    reward: scoreAnswer(3),
    payoff: scoreAnswer(3),
  }));
  const scored = await scoreCopyLine(stub, {
    onScreenCopy: 'Four free tools do the voice work people pay $20 a month for.',
    postIdeaId: 'idea-1',
    runId: null,
    bucket: 'ball_knowledge',
  });
  assert.equal(scored.payoff, 3);
  assert.equal(seen[0]?.sets.length, 2);
  assert.equal(seen[0]?.sets[1], COPY_PAYOFF);
  assert.equal(COPY_PAYOFF.version, 'copy-payoff-v2');
  assert.match(PAYOFF_LEGEND[3], /a repo, a piece of software, or a skill/);
  assert.match(PAYOFF_LEGEND[4], /kind of thing/);
  assert.ok('payoff' in (seen[0]?.questions ?? {}));
  assert.equal(Object.keys(seen[0]?.state ?? {}).join(','), 'on_screen_copy');
});

test('the plain read judges ideas with the same insider list the writer gets', () => {
  const plain = JSON.stringify(COPY_PICK.questions.plain);
  assert.match(plain, /never reads tech news/);
  assert.match(plain, /Mechanism chains/);
  assert.match(plain, /a name or an idea only an insider knows/);
  assert.match(JSON.stringify(COPY_PICK.questions.stake), /the reason is immediate and it is theirs/i);
  assert.doesNotMatch(JSON.stringify(COPY_PICK.questions.loop), /the implication/);
});

test('the same-story check reads the line and the caption opening only', async () => {
  const seen: JevRequest<Questions>[] = [];
  const stub = stubJev(seen, (request) =>
    request.sets[0]?.id === 'copy-story-match'
      ? { sameStory: { type: 'noul', noul: 0.2 } }
      : { plain: scoreAnswer(3), stake: scoreAnswer(3), loop: scoreAnswer(3), care: scoreAnswer(3), reward: scoreAnswer(3) },
  );
  const caption = "Anthropic's CEO wrote a letter.\n\nOpenAI's agents ran attacks.";
  const result = await judgeCopyLine(stub, {
    onScreenCopy: "OpenAI's own agents ran attacks nobody approved.",
    caption,
    postIdeaId: 'idea-1',
    runId: null,
    bucket: 'the_saga',
  });
  assert.equal(result.sameStory, 0.2);
  const story = seen.find((request) => request.sets[0]?.id === 'copy-story-match');
  assert.deepEqual(story?.state, copyStoryMatchState({ onScreenCopy: "OpenAI's own agents ran attacks nobody approved.", caption }));
  assert.equal(captionOpening(caption), "Anthropic's CEO wrote a letter.");
  assert.deepEqual(Object.keys(story?.state ?? {}), ['on_screen_copy', 'caption_opening']);
  assert.equal(COPY_STORY_MATCH.version, 'copy-story-match-v1');
});

// ── The whole idea: drafts, rewrite, pick, save ─────────────────────────────

function reportInput(lines: [string, string], caption: string) {
  return {
    hook_drafts: ['a', 'b', 'c'],
    copy_draft: 'draft',
    caption_draft: 'draft',
    remaining_patterns: [],
    viewer_stake: 'Your passwords could be open to anyone.',
    on_screen_copies: lines,
    caption,
    call_to_action: 'Send this to the friend who built an app.',
    hashtags: ['#AI', '#Security', '#Apps'],
    sources: [],
  };
}

function scriptedClient(replies: Array<ReturnType<typeof reportInput>>, seen: Anthropic.MessageCreateParamsNonStreaming[]): CopyClient {
  return {
    messages: {
      async create(params) {
        seen.push(params);
        const input = replies[seen.length - 1];
        return {
          id: `msg_${seen.length}`,
          type: 'message',
          role: 'assistant',
          model: params.model,
          content: [{ type: 'tool_use', id: `t${seen.length}`, name: 'report_copy', input }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        } as unknown as Anthropic.Message;
      },
    },
  };
}

const TARGET: CopyTarget = {
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
      url: 'https://techcrunch.com/a',
      citationUrls: [],
      author: null,
      byline: null,
      publishTime: null,
    },
  ],
};

/** Lines starting "Strong" clear the gate, "Near" just miss it, and the rest miss by a level. */
function gradedJev(seen: JevRequest<Questions>[]): JevRunner {
  return stubJev(seen, (request) => {
    if (request.sets[0]?.id === 'copy-story-match') return { sameStory: { type: 'noul', noul: 0.9 } };
    if (request.sets[0]?.id === 'full-story-cue') return { readsWell: { type: 'noul', noul: 0.8 } };
    const text = String((request.state as { on_screen_copy?: string }).on_screen_copy ?? '');
    const level = text.startsWith('Strong') ? 3.5 : text.startsWith('Near') ? 2.9 : 2;
    return { plain: scoreAnswer(level), stake: scoreAnswer(level), loop: scoreAnswer(3), care: scoreAnswer(3), reward: scoreAnswer(3) };
  });
}

test('when no draft line clears the gate, one rewrite sees the scores and the pick spans all six lines', async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = scriptedClient(
    [
      reportInput(['Draft one first line', 'Draft one second line'], 'Caption one.\n\nMore.'),
      reportInput(['Draft two first line', 'Draft two second line'], 'Caption two.\n\nMore.'),
      reportInput(['Near rewrite line', 'Strong rewrite line'], 'Rewrite caption.\n\nMore.'),
    ],
    sent,
  );
  const saved: Array<Parameters<typeof saveIdeaCopy>[0]> = [];
  const costs: string[] = [];
  const outcome = await writeTargetCopy(client, 'run-1', 'slate-1', TARGET, {
    jev: gradedJev([]),
    save: async (row) => {
      saved.push(row);
      return true;
    },
    cost: async (row) => {
      costs.push(row.component);
    },
  });

  assert.equal(sent.length, 3);
  assert.deepEqual(costs, ['copy-caption', 'copy-caption', 'copy-rewrite']);
  const firstUser = sent[0].messages[0].content as Anthropic.TextBlockParam[];
  const rewriteUser = sent[2].messages[0].content as Anthropic.TextBlockParam[];
  assert.equal(firstUser[0].text, rewriteUser[0].text, 'the cached sources block is identical');
  assert.ok(rewriteUser[0].cache_control);
  assert.match(rewriteUser[1].text, /did not clear the bar/);
  assert.match(rewriteUser[1].text, /Draft one first line/);
  assert.match(rewriteUser[1].text, /Plain read 0\.50\. The subject is nameable/);
  assert.match(rewriteUser[1].text, /Same story as its caption's opening: yes\./);
  assert.doesNotMatch(firstUser[1].text, /did not clear the bar/);

  assert.equal(outcome.ok, true);
  assert.equal(outcome.onScreenCopy, 'Strong rewrite line');
  assert.equal(outcome.caption, 'Rewrite caption.\n\nMore.');
  assert.equal(saved.length, 1);
  const variants = saved[0].variants;
  assert.equal(variants?.rewrote, true);
  assert.equal(variants?.lines.length, 6);
  assert.equal(variants?.winnerEligible, true);
  assert.deepEqual(variants?.calls.map((entry) => entry.kind), ['draft', 'draft', 'rewrite']);
  assert.equal(saved[0].report?.viewerStake, 'Your passwords could be open to anyone.');
  assert.equal(saved[0].fullStoryCue, 'Full story below');
  assert.equal(saved[0].fullStoryBelow, true);
});

test('when a draft line clears the gate, no rewrite is made', async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = scriptedClient(
    [
      reportInput(['Strong draft line', 'Draft one second line'], 'Caption one.\n\nMore.'),
      reportInput(['Draft two first line', 'Draft two second line'], 'Caption two.\n\nMore.'),
    ],
    sent,
  );
  const outcome = await writeTargetCopy(client, 'run-1', 'slate-1', TARGET, {
    jev: gradedJev([]),
    save: async () => true,
    cost: async () => {},
  });
  assert.equal(sent.length, 2);
  assert.equal(outcome.onScreenCopy, 'Strong draft line');
});

test('when the rewrite still misses, the nearest line across both runs ships', async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = scriptedClient(
    [
      reportInput(['Draft one first line', 'Draft one second line'], 'Caption one.\n\nMore.'),
      reportInput(['Draft two first line', 'Draft two second line'], 'Caption two.\n\nMore.'),
      reportInput(['Near rewrite line', 'Another weak line'], 'Rewrite caption.\n\nMore.'),
    ],
    sent,
  );
  let variants: unknown = null;
  const outcome = await writeTargetCopy(client, 'run-1', 'slate-1', TARGET, {
    jev: gradedJev([]),
    save: async (row) => {
      variants = row.variants;
      return true;
    },
    cost: async () => {},
  });
  assert.equal(sent.length, 3);
  assert.equal(outcome.onScreenCopy, 'Near rewrite line');
  assert.equal((variants as { winnerEligible: boolean }).winnerEligible, false);
});

test('a generation slot keeps the judged lines and does not ship a miss', async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = scriptedClient(
    [
      reportInput(['Draft one first line', 'Draft one second line'], 'Caption one.\n\nMore.'),
      reportInput(['Draft two first line', 'Draft two second line'], 'Caption two.\n\nMore.'),
      reportInput(['Near rewrite line', 'Another weak line'], 'Rewrite caption.\n\nMore.'),
    ],
    sent,
  );
  const outcome = await writeTargetCopy(client, 'run-1', 'slate-1', TARGET, {
    jev: gradedJev([]),
    save: async (row) => {
      assert.equal(row.report, null);
      return true;
    },
    cost: async () => {},
    shipMiss: false,
  });
  assert.equal(sent.length, 3);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.passed, false);
  assert.equal(outcome.judged, true);
  assert.equal(outcome.onScreenCopy, null);
  assert.ok(outcome.variants);
  assert.ok((outcome.variants?.lines.length ?? 0) > 0);
});

test('a replacement idea gets one try and no rewrite', async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = scriptedClient(
    [
      reportInput(['Draft one first line', 'Draft one second line'], 'Caption one.\n\nMore.'),
      reportInput(['Draft two first line', 'Draft two second line'], 'Caption two.\n\nMore.'),
    ],
    sent,
  );
  const outcome = await writeTargetCopy(client, 'run-1', 'slate-1', TARGET, {
    jev: gradedJev([]),
    save: async () => true,
    cost: async () => {},
    rewrite: false,
    shipMiss: false,
  });
  assert.equal(sent.length, 2);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.judged, true);
});

test('a failed attempt reports that the earlier ok copy stays', async () => {
  const client: CopyClient = {
    messages: {
      async create() {
        throw new Error('overloaded');
      },
    },
  };
  const outcome = await writeTargetCopy(client, 'run-1', 'slate-1', TARGET, {
    jev: gradedJev([]),
    save: async (row) => {
      assert.equal(row.report, null);
      return false;
    },
    cost: async () => {},
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? '', /overloaded/);
  assert.match(outcome.error ?? '', /The earlier ok copy stays\./);
});

test('the save appends to the history and never lets a failure replace an ok row', () => {
  assert.match(SAVE_IDEA_COPY_SQL, /INSERT INTO reels\.idea_copy_history/);
  assert.match(SAVE_IDEA_COPY_SQL, /ON CONFLICT \(slate_id, post_idea_id\) DO UPDATE SET/);
  assert.match(SAVE_IDEA_COPY_SQL, /WHERE reels\.idea_copy\.status <> 'ok' OR EXCLUDED\.status = 'ok'/);
  assert.match(SAVE_IDEA_COPY_SQL, /viewer_stake = EXCLUDED\.viewer_stake/);
  assert.ok(SAVE_IDEA_COPY_SQL.indexOf('idea_copy_history') < SAVE_IDEA_COPY_SQL.indexOf('ON CONFLICT'));
});
