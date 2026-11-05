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

test('the post caption never says "critter" (explainer-caption-v7, EX3-121)', async () => {
  const { CAPTION_INSTRUCTIONS, checkNoCritter } = await import('@/lib/explainers/caption');
  assert.match(CAPTION_INSTRUCTIONS, /never call it a "critter"/);
  assert.throws(() => checkNoCritter('The hungry critter plates one slice.'), /says "critter"/);
  assert.throws(() => checkNoCritter('Two Critters wait.'), /Critters/);
  assert.doesNotThrow(() => checkNoCritter('The searcher plates one slice.'));
});

test('caption v13: read from the final script alone, with no Helios line, and one that names Helios is rejected', async () => {
  const { CAPTION_INSTRUCTIONS, CAPTION_VERSION, captionParams, writeExplainerCaption, CaptionError } = await import('@/lib/explainers/caption');
  assert.equal(CAPTION_VERSION, 'explainer-caption-v13');
  assert.match(CAPTION_INSTRUCTIONS, /pick up where the video left off and promise/);
  assert.match(CAPTION_INSTRUCTIONS, /what the average viewer would most want to know/);
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /Helios line|industr|builder_read/i);
  const facts = { title: 'T', scope: 'S', analogy: 'A', storyboard: 'BOARD', script: 'The final words.', source: 'SRC' };
  const params = captionParams(facts, 'm', { retryReason: 'Too thin.' });
  assert.match(JSON.stringify(params.system), /cache_control/);
  const user = String(params.messages[0]!.content);
  assert.match(user, /The final words\./);
  assert.match(user, /rejected: Too thin\./);
  assert.doesNotMatch(user, /BOARD|SRC|Analogy:|Scope:/);
  const clean = `A short hook that promises more below.\n\n${'A plain extra thought for the viewer. '.repeat(8)}\n\nWhich one would you try first?\n\n#ai #tokens #learn`;
  const reply = (caption: string) => ({ messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ caption }) }], usage: { input_tokens: 1, output_tokens: 1 }, model: 'm', stop_reason: 'end_turn' }) } }) as never;
  assert.equal((await writeExplainerCaption(facts, 'm', { client: reply(clean) })).text, clean);
  await assert.rejects(writeExplainerCaption(facts, 'm', { client: reply(clean.replace('Which one', 'At Helios, which one')) }), (e: unknown) => e instanceof CaptionError && /names Helios/.test(e.message));
});
