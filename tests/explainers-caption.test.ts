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

const CONTEXT_WINDOW = `Your AI didn't forget the start of the chat. It fell off the desk.

A context window is the text a language model can see at once, measured in tokens. Think of a desk that only holds so much paper. Once the pile is taller than the desk, the oldest pages slide off the edge. Those pages are gone from what the model can use.

The reel's example is a 1,000-token window and a 1,200-token chat. The first 200 tokens of that chat are no longer in view. That is why a long thread starts answering as if the opening never happened.

This shows up any time a chat runs long, a PDF gets pasted in, or a project file is too big to fit. The model is not being careless. The window filled up.

Save this for the next time a long chat loses the beginning.

#contextwindow #tokens #ai`;

test('the context-window caption passes the post rules', () => {
  const text = parseCaption(CONTEXT_WINDOW);
  assert.equal(text.split('\n')[0], 'Your AI didn\'t forget the start of the chat. It fell off the desk.');
  const hook = text.split('\n')[0]!;
  assert.ok(`${episodeLine(1)}\n\n${hook}`.length <= 125);
  assert.ok(!/^AI Brain Break/i.test(text));
});

test('a caption is rejected when the hook, length, or tags are wrong', () => {
  const base = CONTEXT_WINDOW;
  assert.throws(() => parseCaption(`AI Brain Break Episode 1:\n\n${'x'.repeat(120)}\n\n${base}`), /125/);
  assert.throws(() => parseCaption(base.replace('#ai', '')), /3 to 5/);
  assert.throws(() => parseCaption(`${base} #extra #tags #too #many`), /3 to 5/);
  assert.throws(() => parseCaption(`${base} 🔥`), /emoji/);
  assert.throws(() => parseCaption(base.replace('the chat', 'https://example.com')), /URL/);
  assert.throws(
    () => parseCaption('A short hook.\n\nToo thin.\n\nSave this for later.\n\n#a #b #c'),
    /at least 200/,
  );
});

test('v4 loosens the padding gates: three paragraphs and 200 characters are enough', () => {
  const hook = 'Your AI did not forget the chat. It ran out of desk.';
  const read = 'A law firm pasting a long contract into a chat hits this first, and splitting the file before a model reads it is the kind of step Helios builds.';
  const cta = 'Save this for the next long contract.';
  const body = [hook, read, cta].join('\n\n');
  assert.ok(body.length >= 200 && body.length <= 260, `body is ${body.length}`);
  const caption = `${body}\n\n#contextwindow #tokens #ai`;
  assert.equal(parseCaption(caption), caption);
  assert.throws(
    () => parseCaption(`${hook} ${read}\n\n${cta}\n\n#contextwindow #tokens #ai`),
    /hook, the builder's read, and a call to action/,
  );
});

test('we is allowed: the builder\'s read may speak as Helios', () => {
  const withWe = CONTEXT_WINDOW.replace(
    'The model is not being careless. The window filled up.',
    'At Helios we build the step that trims a long file before the model sees it.',
  );
  assert.equal(parseCaption(withWe), withWe);
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

test('the post caption follows the eight-beat reel and closes on a builder\'s read (explainer-caption-v4)', async () => {
  const { CAPTION_INSTRUCTIONS, CAPTION_VERSION, captionParams } = await import('@/lib/explainers/caption');
  assert.equal(CAPTION_VERSION, 'explainer-caption-v4');
  assert.match(CAPTION_INSTRUCTIONS, /Do not walk the eight beats in order/);
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /catch|seven/);
  assert.ok(CAPTION_INSTRUCTIONS.includes(HELIOS_CONTEXT), 'the Helios context is in the cached prefix');
  assert.ok(CAPTION_INSTRUCTIONS.includes(CAPTION_SHARED_RULES), 'the shared caption rules are in the cached prefix');
  assert.match(CAPTION_INSTRUCTIONS, /builder's read/);
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /no offer of Helios services/);
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /Do not speak as "we"/);
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /Do not sign off with Helios/);
  assert.match(CAPTION_INSTRUCTIONS, /No emoji\. No URLs\./);

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

test('builder_read must be in the caption and name Helios', async () => {
  const { writeExplainerCaption, CaptionError } = await import('@/lib/explainers/caption');
  const facts = { title: 'Context window', scope: null, storyboard: null, script: null, source: null };
  const read = 'An accounting firm feeding a year of receipts to a model hits this wall first, and that split is the kind of step Helios builds.';
  const LAST_BODY = 'This shows up any time a chat runs long, a PDF gets pasted in, or a project file is too big to fit. The model is not being careless. The window filled up.';
  const caption = CONTEXT_WINDOW.replace(LAST_BODY, read);

  const good = stubClient([{ caption, builder_read: read }]);
  const draft = await writeExplainerCaption(facts, 'm', { recent: [], includeBuildLine: true, client: good.client as never });
  assert.equal(draft.text, caption);
  assert.equal(draft.builderRead, read);

  const noHelios = 'An accounting firm feeding a year of receipts to a model hits this wall first.';
  const missing = stubClient([{ caption: CONTEXT_WINDOW.replace(LAST_BODY, noHelios), builder_read: noHelios }]);
  await assert.rejects(
    writeExplainerCaption(facts, 'm', { recent: [], includeBuildLine: false, client: missing.client as never }),
    (error: unknown) => error instanceof CaptionError && /does not name Helios/.test(error.message) && error.spent !== undefined,
  );

  const outside = stubClient([{ caption: CONTEXT_WINDOW, builder_read: read }]);
  await assert.rejects(
    writeExplainerCaption(facts, 'm', { recent: [], includeBuildLine: false, client: outside.client as never }),
    /not a paragraph of the caption/,
  );
});
