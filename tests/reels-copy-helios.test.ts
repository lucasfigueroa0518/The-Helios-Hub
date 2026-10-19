/**
 * Offline tests for copy-caption-v28 (social captions redesign, 2026-10-19):
 * every Reel caption closes on a builder's read that names Helios once, a Jev
 * fit call plus a ceiling over recent closings decides the build line, and the
 * closing is recorded. No model calls: Claude and Jev are stubs, and the
 * database writes are recorders.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { assembleCopyPrompt, buildCopyTaskBlock, copyStaticSystem, type CopyInput } from '@/lib/reels/copy/assemble';
import { buildCopyVariants } from '@/lib/reels/copy/pick';
import {
  CopyReportError,
  REPORT_COPY_TOOL,
  checkCopy,
  fullCaption,
  parseCopyReport,
  publishCopy,
  shortenAssembledCaption,
} from '@/lib/reels/copy/report';
import { COPY_PROMPT_VERSION, COPY_SKILL, FRAMEWORK_WRITING_LOGIC } from '@/lib/reels/copy/skill';
import type { CopyTarget, saveIdeaCopy } from '@/lib/reels/copy/store';
import type { CopyClient } from '@/lib/reels/copy/writer';
import type { JevRequest, JevRunner } from '@/lib/reels/jev/runner';
import { shipStoredCopy, writeTargetCopy } from '@/lib/reels/pipeline/copy';
import {
  BUILD_FIT,
  buildFitState,
  buildLineInstruction,
  recentClosingsBlock,
  type RecentClosing,
} from '@/lib/social/captions/build-line';
import type { ClosingsLog } from '@/lib/social/captions/closings-store';
import { CAPTION_SHARED_RULES, HELIOS_CONTEXT } from '@/lib/social/captions/helios-context';

const READ = 'For a dental practice, this means the front desk stops retyping intake forms. Helios builds that kind of handoff.';
const CAPTION = `Story first line.\n\nMore detail, per TechCrunch.\n\n${READ}`;

function reportInput(extra: Record<string, unknown> = {}) {
  return {
    hook_drafts: ['a', 'b', 'c'],
    copy_draft: 'draft',
    caption_draft: 'draft',
    remaining_patterns: [],
    stake_options: ['a', 'b', 'c'],
    viewer_stake: 'Your passwords could be open to anyone.',
    tension: 'A deputy chased plates and a judge threw the case out.',
    on_screen_copies: ['Strong line one here', 'Strong line two here'],
    caption: CAPTION,
    builder_read: READ,
    call_to_action: 'Send this to the friend who built an app.',
    outcome_note: '',
    hashtags: ['#AI', '#Security', '#Apps'],
    sources: [],
    ...extra,
  };
}

// ── v28 pins ────────────────────────────────────────────────────────────────

test('v28 pins: the version, the Helios context and the shared rules in the cached prefix', () => {
  assert.equal(COPY_PROMPT_VERSION, 'copy-caption-v28');
  const statics = copyStaticSystem();
  assert.ok(statics.includes(HELIOS_CONTEXT));
  assert.ok(statics.includes(CAPTION_SHARED_RULES));
  assert.doesNotMatch(COPY_SKILL, /Helios is an AI consulting firm/);
  assert.doesNotMatch(COPY_SKILL, /no offer of Helios services/);
  assert.match(COPY_SKILL, /no sales pitch, no list of Helios services, and no claim about Helios clients or results/);
  assert.match(COPY_SKILL, /The builder's read is the one place "we" is allowed/);
  assert.match(COPY_SKILL, /just before the call to action/);
  assert.match(COPY_SKILL, /builder_read field/);
  assert.match(COPY_SKILL, /it is the caption's one ask\. It meets the shared rule on varied endings, so the builder's read ends on the take\./);
  assert.match(COPY_SKILL, /so the read ends on the take: never on a question such as "what do you think\?", and never on an ask of its own\./);
  assert.match(FRAMEWORK_WRITING_LOGIC.arousal.caption, /does not name Helios a second time/);
  assert.doesNotMatch(FRAMEWORK_WRITING_LOGIC.arousal.caption, /End the caption on one line that names Helios/);
  assert.ok(REPORT_COPY_TOOL.input_schema.required.includes('builder_read'));
  const properties = Object.keys(REPORT_COPY_TOOL.input_schema.properties);
  assert.ok(properties.indexOf('caption') < properties.indexOf('builder_read'));
});

// ── The report check ────────────────────────────────────────────────────────

test('builder_read must appear in the caption and name Helios', () => {
  const call = parseCopyReport(reportInput());
  assert.equal(call.builderRead, READ);
  assert.equal(call.working.builderRead, READ);

  assert.throws(
    () => parseCopyReport(reportInput({ builder_read: 'A read that the caption never carries. Helios builds it.' })),
    (error: Error) => error instanceof CopyReportError && /builder_read is not a paragraph of the caption/.test(error.message),
  );
  const noHelios = 'For a dental practice, this means the front desk stops retyping intake forms.';
  assert.throws(
    () => parseCopyReport(reportInput({ caption: `Story.\n\n${noHelios}`, builder_read: noHelios })),
    /builder_read does not name Helios/,
  );
  // "Heliosphere" is not Helios.
  const lookalike = 'For a dental practice, the heliosphere changes nothing.';
  assert.throws(
    () => parseCopyReport(reportInput({ caption: `Story.\n\n${lookalike}`, builder_read: lookalike })),
    /builder_read does not name Helios/,
  );
  assert.throws(() => parseCopyReport(reportInput({ builder_read: '' })), /missing builder_read/);

  // Arousal fallback: the call to action already asks to follow Helios, so the read may leave it out.
  const followed = parseCopyReport(
    reportInput({
      caption: `Story.\n\n${noHelios}`,
      builder_read: noHelios,
      call_to_action: 'Follow Helios for the next story like this one.',
    }),
  );
  assert.equal(followed.builderRead, noHelios);
});

// ── The task block ──────────────────────────────────────────────────────────

const CLOSINGS: RecentClosing[] = [
  { closing: 'Old closing about law firms and intake.', buildLine: false, createdAt: new Date('2026-10-18T05:00:00Z') },
];

const MEMBER: CopyInput['members'][number] = {
  role: 'primary',
  sourceName: 'TechCrunch',
  headline: 'Databases exposed',
  body: 'Body text.',
  url: 'https://techcrunch.com/a',
  citationUrls: [],
  author: null,
  byline: null,
  publishTime: null,
};

test('task block carries closings and build-line flag', () => {
  const input: CopyInput = {
    bucket: 'the_number',
    framework: 'arousal',
    members: [MEMBER],
    recentClosings: CLOSINGS,
    includeBuildLine: true,
  };
  const prompt = assembleCopyPrompt(input);
  const user = prompt.messages[0].content;
  const last = user[user.length - 1];
  assert.ok(last.text.includes(recentClosingsBlock(CLOSINGS)));
  assert.ok(last.text.includes(buildLineInstruction(true)));
  assert.equal(last.cache_control, undefined, 'the task block is after the breakpoint');
  const system = JSON.stringify(prompt.system);
  assert.equal(system.includes('Old closing about law firms'), false);
  assert.equal(system.includes(buildLineInstruction(true)), false);
  assert.equal(user[0].text.includes('Old closing about law firms'), false, 'the cached sources block stays the same');

  const line = {
    onScreenCopy: 'Near line',
    words: 2,
    inRange: true,
    scores: { plain: 0.5, stake: 0.5, loop: 0.5, care: 0.5, reward: 0.5 },
    sameStory: true,
  };
  for (const task of [
    buildCopyTaskBlock({ ...input, rewriteOf: [line] }),
    buildCopyTaskBlock({ ...input, polishOf: [line] }),
  ]) {
    assert.ok(task.includes(recentClosingsBlock(CLOSINGS)));
    assert.ok(task.includes(buildLineInstruction(true)));
  }

  const bare = buildCopyTaskBlock({ bucket: 'the_number', framework: 'arousal', members: [MEMBER] });
  assert.ok(bare.includes(buildLineInstruction(false)), 'no flag means no build line');
  assert.equal(bare.includes('Recent captions ended like this'), false, 'an empty log adds no block');
});

// ── The pipeline: Jev fit, ceiling, record ──────────────────────────────────

function stubJev(
  seen: JevRequest<Questions>[],
  fit: (request: JevRequest<Questions>) => Record<string, unknown>,
): JevRunner {
  return {
    callCount: 0,
    async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
      seen.push(request as JevRequest<Questions>);
      const id = request.sets[0]?.id;
      let answers: Record<string, unknown>;
      if (id === 'helios-build-fit') answers = fit(request as JevRequest<Questions>);
      else if (id === 'copy-story-match') answers = { sameStory: { type: 'noul', noul: 0.9 } };
      else if (id === 'full-story-cue') answers = { readsWell: { type: 'noul', noul: 0.8 } };
      else {
        const score = { type: 'score', score: 3.5, confidence: 0.8, probabilities: {}, legend: {} };
        answers = { plain: score, stake: score, loop: score, care: score, reward: score };
      }
      return { model: 'jev-test', answers, usage: { input_tokens: 80, output_tokens: 10 } } as unknown as SystemOneResult<Q>;
    },
  };
}

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

const TARGET: CopyTarget = {
  postIdeaId: 'idea-1',
  rank: 1,
  bucket: 'the_number',
  framework: 'arousal',
  members: [MEMBER, { ...MEMBER, role: 'supporting', headline: 'Second take', body: 'Other body.' }],
};

function recorder(recent: RecentClosing[] | Error) {
  const recorded: Array<[string, string, boolean]> = [];
  const log: ClosingsLog = {
    async recent() {
      if (recent instanceof Error) throw recent;
      return recent;
    },
    async record(subjectId, closing, buildLine) {
      recorded.push([subjectId, closing, buildLine]);
    },
  };
  return { log, recorded };
}

function taskText(params: Anthropic.MessageCreateParamsNonStreaming): string {
  const content = params.messages[0].content as Anthropic.TextBlockParam[];
  return content[content.length - 1].text;
}

test('Jev failure means no build line', async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const seen: JevRequest<Questions>[] = [];
  const saved: Array<Parameters<typeof saveIdeaCopy>[0]> = [];
  const { log, recorded } = recorder([]);
  const jev = stubJev(seen, () => {
    throw new Error('Jev timed out');
  });
  const outcome = await writeTargetCopy(scriptedClient([reportInput(), reportInput()], sent), 'run-1', 'slate-1', TARGET, {
    jev,
    closings: log,
    save: async (row) => {
      saved.push(row);
      return true;
    },
    cost: async () => {},
  });
  assert.equal(outcome.ok, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].report?.builderRead, READ);
  assert.ok(taskText(sent[0]).includes(buildLineInstruction(false)));
  assert.equal(taskText(sent[0]).includes(buildLineInstruction(true)), false);
  assert.deepEqual(recorded, [['idea-1', READ, false]]);
});

test('closing recorded, after a fit Jev asked once on the primary member', async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const seen: JevRequest<Questions>[] = [];
  const { log, recorded } = recorder(CLOSINGS);
  const jev = stubJev(seen, () => ({ builds: { type: 'noul', noul: 0.9 } }));
  await writeTargetCopy(scriptedClient([reportInput(), reportInput()], sent), 'run-1', 'slate-1', TARGET, {
    jev,
    closings: log,
    save: async () => true,
    cost: async () => {},
  });
  const fits = seen.filter((request) => request.component === 'copy-build-fit');
  assert.equal(fits.length, 1);
  assert.deepEqual(fits[0].state, buildFitState({ headline: 'Databases exposed', text: 'Body text.' }));
  assert.equal(fits[0].sets[0]?.version, BUILD_FIT.version);
  assert.equal(fits[0].postIdeaId, 'idea-1');
  for (const params of sent) {
    assert.ok(taskText(params).includes(buildLineInstruction(true)));
    assert.ok(taskText(params).includes(recentClosingsBlock(CLOSINGS)));
  }
  assert.deepEqual(recorded, [['idea-1', READ, true]]);
});

test('a full ceiling skips Jev, and a log that cannot be read counts as empty', async () => {
  const full: RecentClosing[] = [
    { closing: 'One.', buildLine: true, createdAt: new Date() },
    { closing: 'Two.', buildLine: true, createdAt: new Date() },
  ];
  const seen: JevRequest<Questions>[] = [];
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const { log, recorded } = recorder(full);
  await writeTargetCopy(scriptedClient([reportInput(), reportInput()], sent), 'run-1', 'slate-1', TARGET, {
    jev: stubJev(seen, () => ({ builds: { type: 'noul', noul: 0.99 } })),
    closings: log,
    save: async () => true,
    cost: async () => {},
  });
  assert.equal(seen.some((request) => request.component === 'copy-build-fit'), false);
  assert.ok(taskText(sent[0]).includes(buildLineInstruction(false)));
  assert.deepEqual(recorded, [['idea-1', READ, false]]);

  const broken = recorder(new Error('relation social_hub.caption_closings does not exist'));
  const brokenSent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const outcome = await writeTargetCopy(scriptedClient([reportInput(), reportInput()], brokenSent), 'run-1', 'slate-1', TARGET, {
    jev: stubJev([], () => ({ builds: { type: 'noul', noul: 0.9 } })),
    closings: broken.log,
    save: async () => true,
    cost: async () => {},
  });
  assert.equal(outcome.ok, true);
  assert.equal(taskText(brokenSent[0]).includes('Recent captions ended like this'), false);
  assert.ok(taskText(brokenSent[0]).includes(buildLineInstruction(true)));
});

test('a builder read without Helios is rejected once and the retry is billed', async () => {
  const noHelios = 'For a dental practice, this means the front desk stops retyping intake forms.';
  const bad = reportInput({ caption: `Story.\n\n${noHelios}`, builder_read: noHelios });
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const costs: string[] = [];
  const outcome = await writeTargetCopy(scriptedClient([bad, reportInput(), reportInput()], sent), 'run-1', 'slate-1', TARGET, {
    jev: stubJev([], () => ({ builds: { type: 'noul', noul: 0.1 } })),
    save: async () => true,
    cost: async (row) => {
      costs.push(row.component);
    },
  });
  assert.equal(sent.length, 3, 'two draft calls plus one retry');
  assert.deepEqual(costs, ['copy-caption', 'copy-caption', 'copy-caption']);
  assert.equal(outcome.ok, true);
});

// ── Review round 1 ──────────────────────────────────────────────────────────

test('an over-limit caption keeps the builder read and cuts before it', () => {
  const long = 'This paragraph is long enough to cut. '.repeat(30).trim();
  const call = parseCopyReport(reportInput({ caption: [long, long, long, READ].join('\n\n') }));
  const posted = fullCaption(publishCopy(call, 'Strong line one here'));
  assert.ok(posted.length <= 2_200);
  assert.ok(posted.includes(`\n\n${READ}\n\nSend this to the friend who built an app.\n\n#AI #Security #Apps`));
  assert.match(posted, /^This paragraph is long enough to cut\./);

  // An assembled caption (body, read, call to action, hashtags) keeps the read too.
  const assembled = [long, long, long, READ, 'Send this to a friend.', '#AI #Apps'].join('\n\n');
  const shortened = shortenAssembledCaption(assembled);
  assert.ok(shortened.length <= 2_200);
  assert.ok(shortened.endsWith(`${READ}\n\nSend this to a friend.\n\n#AI #Apps`));
});

test('first person in the builder read is not flagged; outside it, it still is', () => {
  const read = 'For a dental practice, we would start with the intake form. Helios builds that kind of handoff.';
  const clean = parseCopyReport(reportInput({ caption: `Story.\n\n${read}`, builder_read: read }));
  assert.deepEqual(checkCopy(publishCopy(clean, 'Strong line one here'), 'the_number', []).firstPersonWords, []);
  const leaky = parseCopyReport(reportInput({ caption: `Our story.\n\n${read}`, builder_read: read }));
  assert.deepEqual(checkCopy(publishCopy(leaky, 'Strong line one here'), 'the_number', []).firstPersonWords, ['Our']);
});

test('shipStoredCopy (ship-a-miss) records the closing with the attempt build-line flag', async () => {
  const call = parseCopyReport(reportInput());
  const { variants } = buildCopyVariants([{ call, error: null }], null, 'the_number');
  const { log, recorded } = recorder([]);
  const saved: Array<Parameters<typeof saveIdeaCopy>[0]> = [];
  const shipped = await shipStoredCopy(
    'run-1',
    'slate-1',
    TARGET,
    variants,
    0,
    { promptVersion: 'copy-caption-v28', model: 'm', inputTokens: 1, outputTokens: 1, usd: 0, buildLine: true },
    {
      jev: stubJev([], () => ({ builds: { type: 'noul', noul: 0.9 } })),
      save: async (row) => {
        saved.push(row);
        return true;
      },
      closings: log,
    },
  );
  assert.equal(shipped.ok, true);
  assert.equal(saved[0].report?.builderRead, READ);
  assert.deepEqual(recorded, [['idea-1', READ, true]]);
});
