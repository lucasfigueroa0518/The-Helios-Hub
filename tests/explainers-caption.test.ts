import assert from 'node:assert/strict';
import test from 'node:test';

import {
  episodeLine,
  parseCaption,
  stampCaption,
  stripEpisodePrefix,
} from '@/lib/explainers/caption';
import { buildLineInstruction, recentClosingsBlock } from '@/lib/social/captions/build-line';
import { CAPTION_SHARED_RULES, HELIOS_CONTEXT } from '@/lib/social/captions/helios-context';
import { nextPublishedEpisode, queuePublish } from '@/lib/explainers/publish/publish';
import { saveFeedback } from '@/lib/explainers/repository';

import { scratchExplainersDb } from './explainers-pglite';

/** v5 shape: problem hook, why paragraphs, the save prompt or question, the Helios line, hashtags. */
const HELIOS_LINE = "A law firm pasting a long contract into a chat feels this first. At Helios we'd split the file and hand the model one section at a time.";
const CONTEXT_WINDOW = `Your long chat with AI forgot how it started. It fell off the desk.

A context window is the text a language model can see at once, measured in tokens. Think of a desk that only holds so much paper. Once the pile is taller than the desk, the oldest pages slide off the edge.

The reel's example is a 1,000-token window and a 1,200-token chat. The first 200 tokens of that chat are no longer in view. That is why a long thread starts answering as if the opening never happened.

Save this for the next time a long chat loses the beginning.

${HELIOS_LINE}

#contextwindow #tokens #ai`;

test('the context-window caption passes the post rules', () => {
  const text = parseCaption(CONTEXT_WINDOW);
  assert.equal(text.split('\n')[0], 'Your long chat with AI forgot how it started. It fell off the desk.');
  const hook = text.split('\n')[0]!;
  assert.ok(`${episodeLine(1)}\n\n${hook}`.length <= 125);
  assert.ok(!/^AI Brain Break/i.test(text));
});

test('a caption is rejected when the hook, length, or tags are wrong', () => {
  const base = CONTEXT_WINDOW;
  assert.throws(() => parseCaption(`AI Brain Break Episode 1:\n\n${'x'.repeat(120)}\n\n${base}`), /125/);
  assert.throws(() => parseCaption(base.replace('#ai', '')), /3 to 5/);
  assert.throws(() => parseCaption(`${base} #extra #tags #too #many`), /3 to 5/);
  assert.throws(() => parseCaption(`${base} 🔥`), /no emoji in the hashtags/);
  assert.throws(() => parseCaption(base.replace('that chat', 'https://example.com')), /URL/);
  assert.throws(
    () => parseCaption('A short hook.\n\nToo thin.\n\nSave this for later.\n\n#a #b #c'),
    /at least 200/,
  );
});

test('v5 keeps the loosened minimums, counting the Helios line: three paragraphs and 200 characters', () => {
  const hook = 'Your long chat with AI forgot how it started. It ran out of desk.';
  const ask = 'Save this for the next long contract.';
  const read = 'A law firm pasting a long contract into a chat hits this first, and splitting the file before a model reads it is the kind of step Helios builds.';
  const body = [hook, ask, read].join('\n\n');
  assert.ok(body.length >= 200 && body.length <= 260, `body is ${body.length}`);
  const caption = `${body}\n\n#contextwindow #tokens #ai`;
  assert.equal(parseCaption(caption), caption);
  assert.throws(
    () => parseCaption(`${hook} ${ask}\n\n${read}\n\n#contextwindow #tokens #ai`),
    /the hook, the save prompt or question, and the Helios line/,
  );
});

test('v5: the paragraph before the hashtags is the Helios line and must name Helios', () => {
  // The old v4 order (Helios in the middle, the ask last) is rejected.
  const v4Order = CONTEXT_WINDOW.replace(`Save this for the next time a long chat loses the beginning.\n\n${HELIOS_LINE}`, `${HELIOS_LINE}\n\nSave this for the next time a long chat loses the beginning.`);
  assert.throws(() => parseCaption(v4Order), /paragraph before the hashtags does not name Helios/);
  const noHelios = CONTEXT_WINDOW.replace(HELIOS_LINE, 'A law firm pasting a long contract into a chat feels this first.');
  assert.throws(() => parseCaption(noHelios), /paragraph before the hashtags does not name Helios/);
  assert.throws(() => parseCaption(CONTEXT_WINDOW.replace('At Helios', 'At Heliosphere')), /does not name Helios/);
});

test('we is allowed: the Helios line may speak as Helios', () => {
  assert.match(HELIOS_LINE, /\bwe'd\b/);
  assert.equal(parseCaption(CONTEXT_WINDOW), CONTEXT_WINDOW);
});

test('publish strips a baked-in episode line and stamps the published count', () => {
  const old = `AI BRAIN BREAK - EPISODE 4:\n\n${CONTEXT_WINDOW}`;
  assert.equal(stripEpisodePrefix(old), CONTEXT_WINDOW);
  assert.equal(stampCaption(old, 1), `${episodeLine(1)}\n\n${CONTEXT_WINDOW}`);
  assert.equal(stampCaption('AI BRAIN BREAK - EPISODE 1: APIs', 2), `${episodeLine(2)}\n\nAPIs`);
});

test('episode numbers count published explainers, not finished renders', async () => {
  const { db } = await scratchExplainersDb();
  assert.equal(await nextPublishedEpisode(db), 1);

  const { rows: t } = await db.query<{ id: string }>(
    `INSERT INTO explainers.topics (title, origin, status) VALUES ('Context window', 'manual', 'rendered') RETURNING id`,
  );
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at)
     VALUES ($1, 'ok', 'click', 'development', 5, 'm', 'm', now()) RETURNING id`,
    [t[0]!.id],
  );
  const jobId = j[0]!.id;
  await db.query(
    `INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location)
     VALUES ($1, 'video', $2, 5000000, 'bucket')`,
    [jobId, `jobs/${jobId}/video.mp4`],
  );
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, content) VALUES ($1, 'post_caption', $2)`, [jobId, CONTEXT_WINDOW]);
  await saveFeedback(db, { jobId, verdict: 'approved', tags: [] });

  const queued = await queuePublish(db, jobId, 'approve');
  assert.equal(queued.queued, true);
  assert.equal(await nextPublishedEpisode(db), 1, 'queued is not published');

  await db.query(`UPDATE social_hub.publish_attempts SET status = 'published', media_id = 'm1', finished_at = now() WHERE vertical = 'explainers'`);
  assert.equal(await nextPublishedEpisode(db), 2);

  // Archived on Instagram (gone from the account's media list): it no longer counts, and an
  // unarchived post counts again (Lucas, 2026-10-13).
  const since: Date[] = [];
  const profile = (ids: string[]) => ({ liveMediaIds: async (d: Date) => (since.push(d), new Set(ids)) });
  assert.equal(await nextPublishedEpisode(db, profile([])), 1, 'archived: the series restarts');
  assert.equal(await nextPublishedEpisode(db, profile(['m1', 'other'])), 2, 'still on the profile');
  assert.ok(since[0].getTime() < Date.now() - 23 * 60 * 60 * 1000, 'the read reaches back past the oldest post');
  // A failed read never resets the series.
  assert.equal(await nextPublishedEpisode(db, { liveMediaIds: async () => { throw new Error('Meta returned 500'); } }), 2);
  assert.equal(await nextPublishedEpisode(db, {}), 2, 'no read: every published explainer counts');
});

test('the post caption names the viewer\'s problem and ends on the Helios line (explainer-caption-v5)', async () => {
  const { CAPTION_INSTRUCTIONS, CAPTION_VERSION, captionParams } = await import('@/lib/explainers/caption');
  assert.equal(CAPTION_VERSION, 'explainer-caption-v5');
  assert.match(CAPTION_INSTRUCTIONS, /names a problem or situation the viewer has/);
  assert.match(CAPTION_INSTRUCTIONS, /the hook, two or three short paragraphs on why, the save prompt or question, the Helios line, then the hashtags/);
  assert.match(CAPTION_INSTRUCTIONS, /which of the reel's options they would use first/);
  assert.match(CAPTION_INSTRUCTIONS, /The Helios line is the last paragraph before the hashtags/);
  assert.match(CAPTION_INSTRUCTIONS, /may end by inviting the viewer to follow/);
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /just before the call to action/);
  assert.ok(!CAPTION_INSTRUCTIONS.includes('\u2014'), 'no em dashes');
  assert.match(CAPTION_INSTRUCTIONS, /Do not walk the eight beats in order/);
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /catch|seven/);
  assert.ok(CAPTION_INSTRUCTIONS.includes(HELIOS_CONTEXT), 'the Helios context is in the cached prefix');
  assert.ok(CAPTION_INSTRUCTIONS.includes(CAPTION_SHARED_RULES), 'the shared caption rules are in the cached prefix');
  assert.match(CAPTION_INSTRUCTIONS, /Helios line/);
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /no offer of Helios services/);
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /Do not speak as "we"/);
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /Do not sign off with Helios/);
  assert.match(CAPTION_INSTRUCTIONS, /No URLs\./);

  const facts = { title: 'Context window', scope: 'What a model can see.', storyboard: 'sb', script: 'sc', source: null };
  const recent = [{ closing: 'A dental practice hits this when Helios wires the front desk.', buildLine: true, createdAt: new Date() }];
  const params = captionParams(facts, 'claude-sonnet-5-5', { recent, includeBuildLine: true });
  const system = JSON.stringify(params.system);
  assert.match(system, /cache_control/);
  assert.doesNotMatch(system, /dental practice|include_build_line/, 'per-post inputs stay out of the cached prefix');
  const user = String(params.messages[0]!.content);
  assert.ok(user.includes(recentClosingsBlock(recent)));
  assert.ok(user.includes(buildLineInstruction(true)));
  const schema = params.output_config.format.schema as { required: string[] };
  assert.deepEqual(schema.required, ['caption', 'builder_read']);

  const empty = String(captionParams(facts, 'm', { recent: [], includeBuildLine: false }).messages[0]!.content);
  assert.doesNotMatch(empty, /Recent captions ended like this/);
  assert.ok(empty.includes(buildLineInstruction(false)));
});

function stubClient(replies: { caption: string; builder_read: string }[]) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          const reply = replies[calls.length - 1]!;
          return {
            model: 'claude-sonnet-5-5',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify(reply) }],
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          };
        },
      },
    },
  };
}

test('builder_read is the Helios line before the hashtags and names Helios', async () => {
  const { writeExplainerCaption, CaptionError } = await import('@/lib/explainers/caption');
  const facts = { title: 'Context window', scope: null, storyboard: null, script: null, source: null };

  const good = stubClient([{ caption: CONTEXT_WINDOW, builder_read: HELIOS_LINE }]);
  const draft = await writeExplainerCaption(facts, 'm', { recent: [], includeBuildLine: true, client: good.client as never });
  assert.equal(draft.text, CONTEXT_WINDOW);
  assert.equal(draft.builderRead, HELIOS_LINE);

  const noHelios = 'An accounting firm feeding a year of receipts to a model hits this wall first.';
  const missing = stubClient([{ caption: CONTEXT_WINDOW.replace(HELIOS_LINE, noHelios), builder_read: noHelios }]);
  await assert.rejects(
    writeExplainerCaption(facts, 'm', { recent: [], includeBuildLine: false, client: missing.client as never }),
    (error: unknown) => error instanceof CaptionError && /does not name Helios/.test(error.message) && error.spent !== undefined,
  );

  // A read copied from somewhere else in the caption is not the Helios line.
  const elsewhere = 'Save this for the next time a long chat loses the beginning.';
  const outside = stubClient([{ caption: CONTEXT_WINDOW, builder_read: elsewhere }]);
  await assert.rejects(
    writeExplainerCaption(facts, 'm', { recent: [], includeBuildLine: false, client: outside.client as never }),
    /not the caption's last paragraph before the hashtags/,
  );
});

test('a retry tells the writer why the last caption was rejected, after the cache breakpoint', async () => {
  const { captionParams, writeExplainerCaption } = await import('@/lib/explainers/caption');
  const facts = { title: 'Context window', scope: null, storyboard: null, script: null, source: null };
  const reason = 'the paragraph before the hashtags does not name Helios.';
  const params = captionParams(facts, 'm', { recent: [], includeBuildLine: false, retryReason: reason });
  assert.doesNotMatch(JSON.stringify(params.system), /was rejected/);
  const user = String(params.messages[0]!.content);
  assert.ok(user.trimEnd().endsWith(`Your last caption for this reel was rejected: ${reason} Fix that, and keep every other rule.`));
  assert.doesNotMatch(String(captionParams(facts, 'm', { recent: [], includeBuildLine: false }).messages[0]!.content), /was rejected/);

  const stub = stubClient([{ caption: CONTEXT_WINDOW, builder_read: HELIOS_LINE }]);
  await writeExplainerCaption(facts, 'm', { recent: [], includeBuildLine: false, retryReason: reason, client: stub.client as never });
  assert.match(JSON.stringify(stub.calls[0]), /was rejected: the paragraph before the hashtags does not name Helios/);
});

test('the build-fit Jev call is keyed by the subject id it is given, not the title', async () => {
  const { liveExplainerBuildFit } = await import('@/lib/explainers/caption');
  const metas: unknown[] = [];
  const ask = (async (_request: unknown, meta: unknown) => (metas.push(meta), { answers: { builds: { noul: 0.7 } }, usage: { input_tokens: 1, output_tokens: 1 } })) as never;
  const fit = liveExplainerBuildFit(ask);
  assert.equal(await fit({ title: 'Context window', scope: null, storyboard: null, script: 'sc', source: null }, 'job-42'), 0.7);
  assert.deepEqual(metas, [{ version: 'helios-build-fit@1', subjectId: 'job-42' }]);
});

test('Task 8b part 2 (v5 amended): at most two emoji, one leading the hook and one after the ask; none in the Helios line or hashtags', async () => {
  const withTwo = CONTEXT_WINDOW.replace('Your long chat', '🧠 Your long chat').replace('loses the beginning.', 'loses the beginning. 👇');
  assert.equal(parseCaption(withTwo), withTwo);
  // The emoji follows the episode stamp that code adds.
  assert.ok(stampCaption(withTwo, 3).startsWith(`${episodeLine(3)}\n\n🧠 Your long chat`));
  assert.throws(() => parseCaption(withTwo.replace('desk.', 'desk. 🔥')), /3 emoji; at most 2/);
  assert.throws(() => parseCaption(CONTEXT_WINDOW.replace("one section at a time.", 'one section at a time. 🚀')), /no emoji in the Helios line/);
  const { CAPTION_INSTRUCTIONS, CAPTION_VERSION } = await import('@/lib/explainers/caption');
  assert.equal(CAPTION_VERSION, 'explainer-caption-v5');
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /No emoji\./);
  assert.match(CAPTION_INSTRUCTIONS, /At most two emoji/);
  assert.match(CAPTION_INSTRUCTIONS, /code puts the episode line above it/);
  assert.match(CAPTION_INSTRUCTIONS, /None in the Helios line or the hashtags/);
  assert.match(CAPTION_INSTRUCTIONS, /Prefer naming a specific industry from the Helios context/);
});
