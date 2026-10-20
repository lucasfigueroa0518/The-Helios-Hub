/**
 * v29 (Task 8b, per-format comps): the Helios line leaves the caption body and
 * posts last, after the call to action and before the hashtags.
 *
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
  isTextArtifactError,
  parseCopyReport,
  publishCopy,
  reportArtifacts,
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
const CAPTION = 'Story first line.\n\nMore detail, per TechCrunch.';
const CTA = 'Send this to the friend who built an app.';

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
    call_to_action: CTA,
    outcome_note: '',
    hashtags: ['#AI', '#Security', '#Apps'],
    sources: [],
    ...extra,
  };
}

// ── v29 pins ────────────────────────────────────────────────────────────────

test('v29 pins: the version, the Helios context and the shared rules in the cached prefix', () => {
  assert.equal(COPY_PROMPT_VERSION, 'copy-caption-v29');
  const statics = copyStaticSystem();
  assert.ok(statics.includes(HELIOS_CONTEXT));
  assert.ok(statics.includes(CAPTION_SHARED_RULES));
  assert.doesNotMatch(COPY_SKILL, /Helios is an AI consulting firm/);
  assert.doesNotMatch(COPY_SKILL, /no offer of Helios services/);
  assert.match(COPY_SKILL, /no sales pitch, no list of Helios services, and no claim about Helios clients or results/);
  assert.match(COPY_SKILL, /The Helios line is the one place "we" is allowed/);
  assert.match(COPY_SKILL, /builder_read field/);
  assert.ok(REPORT_COPY_TOOL.input_schema.required.includes('builder_read'));
  const properties = Object.keys(REPORT_COPY_TOOL.input_schema.properties);
  assert.ok(properties.indexOf('caption') < properties.indexOf('builder_read'));
});

test('v29: the Helios line ends the post, after the call to action, and leaves the caption body', () => {
  assert.doesNotMatch(COPY_SKILL, /just before the call to action/);
  assert.match(COPY_SKILL, /The Helios line ends the post, after the call to action and before the hashtags/);
  assert.match(COPY_SKILL, /Leave the call to action, the Helios line, and the hashtags out of the caption/);
  assert.match(COPY_SKILL, /call to action, the Helios line, and the hashtags together stay within 2,200 characters/);
  assert.match(COPY_SKILL, /Lead it with a number, a quote, or a vivid claim when the story has one/);
  const tool = REPORT_COPY_TOOL.input_schema.properties;
  assert.doesNotMatch(tool.caption.description, /builder's read as its last paragraph/);
  assert.match(tool.caption.description, /Leave out the call to action, the Helios line, and the hashtags/);
  assert.match(tool.builder_read.description, /after the call to action and before the hashtags/);
  assert.match(tool.builder_read.description, /not part of the caption field/i);
});

test('v29 arousal: the call to action and the Helios line never both name Helios', () => {
  assert.match(COPY_SKILL, /The call to action never names Helios/);
  assert.doesNotMatch(COPY_SKILL, /the call to action names Helios and the read does not name it again/);
  assert.match(FRAMEWORK_WRITING_LOGIC.arousal.caption, /ask to follow for the next story like this one, without naming Helios/);
  assert.doesNotMatch(FRAMEWORK_WRITING_LOGIC.arousal.caption, /does not name Helios a second time/);
  for (const logic of Object.values(FRAMEWORK_WRITING_LOGIC)) {
    assert.doesNotMatch(logic.caption, /follow Helios|ask to save the post instead/);
  }
});

// ── The report check ────────────────────────────────────────────────────────

test('builder_read is the Helios line: it names Helios and stays out of the caption body', () => {
  const call = parseCopyReport(reportInput());
  assert.equal(call.builderRead, READ);
  assert.equal(call.working.builderRead, READ);
  assert.equal(call.caption, CAPTION);

  // A read the model also wrote into the caption is moved out, so it posts once.
  const repeated = parseCopyReport(reportInput({ caption: `${CAPTION}\n\n${READ}` }));
  assert.equal(repeated.caption, CAPTION);
  const beforeCta = parseCopyReport(reportInput({ caption: `${CAPTION}\n\n${CTA}\n\n${READ}` }));
  assert.equal(beforeCta.caption, CAPTION);

  const noHelios = 'For a dental practice, this means the front desk stops retyping intake forms.';
  assert.throws(
    () => parseCopyReport(reportInput({ builder_read: noHelios })),
    (error: Error) => error instanceof CopyReportError && /builder_read does not name Helios/.test(error.message),
  );
  // "Heliosphere" is not Helios.
  assert.throws(() => parseCopyReport(reportInput({ builder_read: 'For a dental practice, the heliosphere changes nothing.' })), /builder_read does not name Helios/);
  assert.throws(() => parseCopyReport(reportInput({ builder_read: '' })), /missing builder_read/);

  // v29: no exemption when the call to action names Helios. The Helios line always carries the name.
  assert.throws(
    () => parseCopyReport(reportInput({ builder_read: noHelios, call_to_action: 'Follow Helios for the next story like this one.' })),
    /builder_read does not name Helios/,
  );
});

test('tool syntax or a leftover escape in the Helios line is a text artifact, so the copy-time retry fires', () => {
  const leak = `${READ} "call_to_action": "Follow for more"`;
  assert.throws(() => parseCopyReport(reportInput({ builder_read: leak })), (error: Error) => isTextArtifactError(error.message) && /tool syntax in Helios line/.test(error.message));
  const base = parseCopyReport(reportInput());
  assert.deepEqual(reportArtifacts({ ...base, builderRead: `${READ}\\n` }), ['escape sequence in Helios line']);
  assert.deepEqual(reportArtifacts(base), []);
});

test('fullCaption posts the body, the call to action, the Helios line, then the hashtags', () => {
  const posted = fullCaption(publishCopy(parseCopyReport(reportInput()), 'Strong line one here'));
  assert.equal(posted, `${CAPTION}\n\n${CTA}\n\n${READ}\n\n#AI #Security #Apps`);

  // A v28 row stored the read as the caption's last paragraph: it moves after the call to action and posts once.
  const v28 = fullCaption({ caption: `${CAPTION}\n\n${READ}`, builderRead: READ, callToAction: CTA, hashtags: ['#AI'] });
  assert.equal(v28, `${CAPTION}\n\n${CTA}\n\n${READ}\n\n#AI`);
  // No read (rows before v28): body, call to action, hashtags, as before.
  assert.equal(fullCaption({ caption: CAPTION, callToAction: CTA, hashtags: ['#AI'] }), `${CAPTION}\n\n${CTA}\n\n#AI`);
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

test('a full ceiling skips Jev, and a log that cannot be read fails closed (no Jev, no build line)', async () => {
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
  const brokenSeen: JevRequest<Questions>[] = [];
  const outcome = await writeTargetCopy(scriptedClient([reportInput(), reportInput()], brokenSent), 'run-1', 'slate-1', TARGET, {
    jev: stubJev(brokenSeen, () => ({ builds: { type: 'noul', noul: 0.9 } })),
    closings: broken.log,
    save: async () => true,
    cost: async () => {},
  });
  assert.equal(outcome.ok, true);
  assert.equal(taskText(brokenSent[0]).includes('Recent captions ended like this'), false);
  assert.equal(brokenSeen.some((request) => request.component === 'copy-build-fit'), false, 'no Jev fit call');
  assert.ok(taskText(brokenSent[0]).includes(buildLineInstruction(false)));
  assert.equal(taskText(brokenSent[0]).includes(buildLineInstruction(true)), false);
});

test('a builder read without Helios is rejected once and the retry is billed', async () => {
  const noHelios = 'For a dental practice, this means the front desk stops retyping intake forms.';
  const bad = reportInput({ builder_read: noHelios });
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

test('an over-limit caption keeps the Helios line and the call to action, and drops body paragraphs from just before them', () => {
  const first = 'The first paragraph stays in the caption. '.repeat(30).trim();
  const middle = 'The middle paragraph goes after the last. '.repeat(30).trim();
  const last = 'The last body paragraph goes first. '.repeat(30).trim();
  const call = parseCopyReport(reportInput({ caption: [first, middle, last].join('\n\n') }));
  const posted = fullCaption(publishCopy(call, 'Strong line one here'));
  assert.ok(posted.length <= 2_200);
  assert.ok(posted.endsWith(`\n\n${CTA}\n\n${READ}\n\n#AI #Security #Apps`));
  assert.ok(posted.startsWith(first));
  assert.equal(posted.includes(last), false);

  // An assembled caption (body, call to action, Helios line, hashtags) keeps both too.
  const assembled = [first, middle, last, 'Send this to a friend.', READ, '#AI #Apps'].join('\n\n');
  const shortened = shortenAssembledCaption(assembled);
  assert.ok(shortened.length <= 2_200);
  assert.ok(shortened.startsWith(first));
  assert.ok(shortened.endsWith(`Send this to a friend.\n\n${READ}\n\n#AI #Apps`));
});

test('first person in the Helios line is not flagged; outside it, it still is', () => {
  const read = 'For a dental practice, we would start with the intake form. Helios builds that kind of handoff.';
  const clean = parseCopyReport(reportInput({ builder_read: read }));
  assert.deepEqual(checkCopy(publishCopy(clean, 'Strong line one here'), 'the_number', []).firstPersonWords, []);
  const leaky = parseCopyReport(reportInput({ caption: 'Our story.\n\nMore detail.', builder_read: read }));
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

// ── v29: the posting path reads the Helios line from the stored row ─────────

test('publishReadiness posts a stored v29 row (and a v28 row) as body, call to action, Helios line, hashtags', async (t) => {
  const { openHubTestDb } = await import('./fixtures/social-hub/pglite');
  const { publishReadiness } = await import('@/lib/reels/music/publish');
  const { pg } = await openHubTestDb();
  const g = globalThis as { __outreachHubPool?: unknown };
  const hadPool = '__outreachHubPool' in g;
  const previousPool = g.__outreachHubPool;
  // Put the pool back for the tests that run after this one.
  t.after(() => {
    if (hadPool) g.__outreachHubPool = previousPool;
    else delete g.__outreachHubPool;
  });
  g.__outreachHubPool = {
    query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]),
  };
  const [idea, slate, video, run] = [1, 2, 3, 4].map((n) => `72900000-0000-4000-8000-00000000000${n}`);
  await pg.query(`INSERT INTO reels.runs (id, trigger, status) VALUES ($1, 'scheduled', 'ok')`, [run]);
  await pg.query(`INSERT INTO reels.post_ideas (id) VALUES ($1)`, [idea]);
  await pg.query(
    `INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ($1, $2, '2026-10-19', now(), 'p1', 'p2')`,
    [slate, run],
  );
  await pg.query(
    `INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags, working)
     VALUES ($1, $2, 'copy-caption-v29', 'm', 'b', 'f', 'ok', $3, $4, ARRAY['#AI'], $5::jsonb)`,
    [slate, idea, CAPTION, CTA, JSON.stringify({ builderRead: READ })],
  );
  await pg.query(
    `INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path) VALUES ($1, $2, $3, 'ok', now(), 'videos/x.mp4')`,
    [video, idea, slate],
  );
  await pg.query(
    `INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist) VALUES ($1, $2, 'ok', now(), 'aud-7', 'Song', 'Artist')`,
    [video, idea],
  );
  const ready = await publishReadiness(video, { mixOverride: { audioVolume: 100, videoVolume: 100 } });
  assert.ok(ready.ok, ready.ok ? '' : ready.note);
  assert.equal(ready.reel.caption, `${CAPTION}\n\n${CTA}\n\n${READ}\n\n#AI`);

  // A v28 row already in review: the read is the caption's last paragraph and in working. It posts once, after the call to action.
  const [idea28, video28] = ['72900000-0000-4000-8000-000000000005', '72900000-0000-4000-8000-000000000006'];
  await pg.query(`INSERT INTO reels.post_ideas (id) VALUES ($1)`, [idea28]);
  await pg.query(
    `INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags, working)
     VALUES ($1, $2, 'copy-caption-v28', 'm', 'b', 'f', 'ok', $3, $4, ARRAY['#AI'], $5::jsonb)`,
    [slate, idea28, `${CAPTION}\n\n${READ}`, CTA, JSON.stringify({ builderRead: READ })],
  );
  await pg.query(
    `INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path) VALUES ($1, $2, $3, 'ok', now(), 'videos/y.mp4')`,
    [video28, idea28, slate],
  );
  await pg.query(
    `INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist) VALUES ($1, $2, 'ok', now(), 'aud-8', 'Song', 'Artist')`,
    [video28, idea28],
  );
  const v28 = await publishReadiness(video28, { mixOverride: { audioVolume: 100, videoVolume: 100 } });
  assert.ok(v28.ok, v28.ok ? '' : v28.note);
  assert.equal(v28.reel.caption, `${CAPTION}\n\n${CTA}\n\n${READ}\n\n#AI`);
  assert.equal(v28.reel.caption.split(READ).length - 1, 1, 'the read posts once');
});

test('Task 8b part 2 (v29 amended): at most two emoji, none in the Helios line; the line prefers a named industry', () => {
  assert.equal(COPY_PROMPT_VERSION, 'copy-caption-v29');
  assert.doesNotMatch(COPY_SKILL, /No emoji\./);
  assert.match(COPY_SKILL, /At most two emoji, and none is required: usually one leads the caption's first line and one ends the call to action/);
  assert.match(COPY_SKILL, /Never put one in the Helios line or the hashtags/);
  assert.match(COPY_SKILL, /the industry from the Helios context that best matches this story/);
});

test('a v28 row cannot post its read twice: the body copy is dropped even when spacing differs', () => {
  const spaced = READ.replace('. Helios', '.\nHelios');
  const posted = fullCaption({ caption: `${CAPTION}\n\n${spaced}`, builderRead: READ, callToAction: CTA, hashtags: ['#AI'] });
  assert.equal(posted, `${CAPTION}\n\n${CTA}\n\n${READ}\n\n#AI`);
  assert.equal(posted.split('Helios builds').length - 1, 1);
  // The read the model also wrote before the call to action in the caption is dropped too.
  const both = fullCaption({ caption: `${CAPTION}\n\n${READ}\n\n${CTA}`, builderRead: READ, callToAction: CTA, hashtags: ['#AI'] });
  assert.equal(both, `${CAPTION}\n\n${CTA}\n\n${READ}\n\n#AI`);
});

test('fix round 1: the publishReadiness test leaves no test pool behind', () => {
  assert.equal('__outreachHubPool' in globalThis, false);
});

test("copy fix (v29 amended, 2026-10-20): the Helios line is one concrete point in Helios's view; a follow clause is rare", () => {
  assert.equal(COPY_PROMPT_VERSION, 'copy-caption-v29');
  assert.match(COPY_SKILL, /one or two plain sentences that make one concrete point about this story for the industry it names/);
  assert.match(COPY_SKILL, /It ends on the point/);
  assert.match(COPY_SKILL, /a short follow clause may close it now and then, never by default/);
  assert.doesNotMatch(COPY_SKILL, /the line may end by inviting the viewer to follow Helios/);
  assert.match(COPY_SKILL, /Keep each paragraph to one or two sentences, and cut a secondary fact no part needs/);
});
