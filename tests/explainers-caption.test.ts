import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPTION_MAX_CHARS,
  parseCaption,
  reviewCaption,
  stripEpisodePrefix,
  withHeliosLine,
} from '@/lib/explainers/caption';
import { CAPTION_WRITER_MAX_CHARS } from '@/lib/explainers/caption-format';
import { nextPublishedEpisode, queuePublish } from '@/lib/explainers/publish/publish';
import { saveFeedback } from '@/lib/explainers/repository';
import { heliosLine, heliosLines, longestHeliosLine } from '@/lib/social/captions/helios-line';
import { readHeliosVoice } from '@/lib/social/voice/voice';

import { scratchExplainersDb } from './explainers-pglite';

/** v14 shape: the writer's hook and paragraphs, then hashtags. Code adds the Helios line before the hashtags. */
const CONTEXT_WINDOW = `Your long chat with AI forgot how it started. It fell off the desk.

A context window is the text a language model can see at once, measured in tokens. Think of a desk that only holds so much paper. Once the pile is taller than the desk, the oldest pages slide off the edge.

The reel's example is a 1,000-token window and a 1,200-token chat. The first 200 tokens of that chat are no longer in view. That is why a long thread starts answering as if the opening never happened.

#contextwindow #tokens #ai`;

test('the context-window caption passes the post rules', () => {
  const text = parseCaption(CONTEXT_WINDOW);
  assert.equal(text, CONTEXT_WINDOW);
  assert.equal(text.split('\n')[0], 'Your long chat with AI forgot how it started. It fell off the desk.');
  assert.ok(!/^AI Brain Break|^AI 101 Episode/i.test(text));
});

test('a caption is rejected when the hook, length, or tags are wrong', () => {
  const base = CONTEXT_WINDOW;
  assert.throws(() => parseCaption(`AI Brain Break Episode 1:\n\n${'x'.repeat(130)}\n\n${base}`), /125/);
  assert.throws(() => parseCaption(base.replace('#ai', '')), /3 to 5/);
  assert.throws(() => parseCaption(`${base} #extra #tags #too #many`), /3 to 5/);
  assert.throws(() => parseCaption(`${base} 🔥`), /no emoji in the hashtags/);
  assert.throws(() => parseCaption(base.replace('that chat', 'https://example.com')), /URL/);
  assert.throws(() => parseCaption('A short hook.\n\nToo thin.\n\n#a #b #c'), /at least 120/);
});

test('v14 minimums: a 120-character body with a hook and one paragraph passes; one paragraph alone does not', () => {
  const hook = 'Your long chat with AI forgot how it started.';
  const para = 'The oldest messages slid out of the window the model can see, so it answers as if they never existed.';
  const caption = `${hook}\n\n${para}\n\n#contextwindow #tokens #ai`;
  assert.ok(`${hook}\n\n${para}`.length >= 120 && `${hook}\n\n${para}`.length < 200);
  assert.equal(parseCaption(caption), caption);
  assert.throws(() => parseCaption(`${hook} ${para}\n\n#contextwindow #tokens #ai`), /hook and at least one paragraph/);
});

test('parseCaption has no Helios-line rule: the writer text and the text with its Helios line both pass', () => {
  assert.equal(parseCaption(CONTEXT_WINDOW), CONTEXT_WINDOW);
  const withLine = withHeliosLine(CONTEXT_WINDOW, 'job-1');
  assert.equal(parseCaption(withLine), withLine);
});

test('an older caption has its episode line stripped; the review drawer shows it as it posts', () => {
  const old = `AI BRAIN BREAK - EPISODE 4:\n\n${CONTEXT_WINDOW}`;
  assert.equal(stripEpisodePrefix(old), CONTEXT_WINDOW);
  assert.equal(stripEpisodePrefix('AI 101 Episode 7: APIs'), 'APIs');
  assert.equal(reviewCaption(old), CONTEXT_WINDOW);
});

test('withHeliosLine puts the Helios line between the text and the hashtags', () => {
  const out = withHeliosLine(CONTEXT_WINDOW, 'job-1');
  const line = heliosLine('explainers', 'job-1');
  const body = CONTEXT_WINDOW.slice(0, CONTEXT_WINDOW.indexOf('#contextwindow')).trim();
  assert.equal(out, `${body}\n\n${line}\n\n#contextwindow #tokens #ai`);
  assert.ok(heliosLines('explainers').includes(line));
  assert.equal(withHeliosLine('A caption with no tags yet.', 'job-1'), `A caption with no tags yet.\n\n${line}`);
});

test('withHeliosLine is idempotent, whatever the seed, and drops an old episode line', () => {
  const once = withHeliosLine(CONTEXT_WINDOW, 'job-1');
  assert.equal(withHeliosLine(once, 'job-1'), once);
  assert.equal(withHeliosLine(once, 'another-job'), once, 'a caption that already has a Helios line keeps it');
  assert.equal(withHeliosLine(`AI 101 Episode 3:\n\n${CONTEXT_WINDOW}`, 'job-1'), once);
});

test('the writer leaves room for the longest Helios line', () => {
  assert.equal(CAPTION_WRITER_MAX_CHARS, CAPTION_MAX_CHARS - longestHeliosLine('explainers').length - 2);
  const tags = '#a #b #c';
  const text = `${'x'.repeat(CAPTION_WRITER_MAX_CHARS - tags.length - 2)}\n\n${tags}`;
  assert.equal(text.length, CAPTION_WRITER_MAX_CHARS);
  assert.ok(withHeliosLine(text, 'x').length <= CAPTION_MAX_CHARS);
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

test('the post caption never says "critter" (explainer-caption-v7, EX3-121)', async () => {
  const { CAPTION_INSTRUCTIONS, checkNoCritter } = await import('@/lib/explainers/caption');
  assert.match(CAPTION_INSTRUCTIONS, /never call it a "critter"/);
  assert.throws(() => checkNoCritter('The hungry critter plates one slice.'), /says "critter"/);
  assert.throws(() => checkNoCritter('Two Critters wait.'), /Critters/);
  assert.doesNotThrow(() => checkNoCritter('The searcher plates one slice.'));
});

test('caption v14: the shared voice then the instructions, read from the final script, and code owns the Helios line', async () => {
  const { CAPTION_INSTRUCTIONS, CAPTION_VERSION, captionParams, captionSystem, writeExplainerCaption, CaptionError } = await import('@/lib/explainers/caption');
  assert.equal(CAPTION_VERSION, 'explainer-caption-v14');
  assert.equal(captionSystem(), `${readHeliosVoice()}\n\n# This caption\n\n${CAPTION_INSTRUCTIONS}\n\nVersion: ${CAPTION_VERSION}`);
  assert.match(CAPTION_INSTRUCTIONS, /Code adds a line about the page after your text, before your hashtags/);
  assert.match(CAPTION_INSTRUCTIONS, /do not write an episode title or number/);
  assert.match(CAPTION_INSTRUCTIONS, new RegExp(`stays within ${CAPTION_WRITER_MAX_CHARS} characters`));
  assert.doesNotMatch(CAPTION_INSTRUCTIONS, /Helios line|industr|builder_read/i);
  const facts = { title: 'T', scope: 'S', analogy: 'A', storyboard: 'BOARD', script: 'The final words.', source: 'SRC' };
  const params = captionParams(facts, 'm', { retryReason: 'Too thin.' });
  const system = params.system as Array<{ text: string; cache_control?: unknown }>;
  assert.ok(system[0]!.cache_control, 'the system prefix carries the cache breakpoint');
  assert.equal(system[0]!.text, captionSystem());
  const user = String(params.messages[0]!.content);
  assert.match(user, /The final words\./);
  assert.match(user, /rejected: Too thin\./);
  assert.doesNotMatch(user, /BOARD|SRC|Analogy:|Scope:/);
  const clean = `A short hook that promises more below.\n\n${'A plain extra thought for the viewer. '.repeat(8)}\n\n#ai #tokens #learn`;
  const reply = (caption: string) => ({ messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ caption }) }], usage: { input_tokens: 1, output_tokens: 1 }, model: 'm', stop_reason: 'end_turn' }) } }) as never;
  assert.equal((await writeExplainerCaption(facts, 'm', { client: reply(clean) })).text, clean);
  await assert.rejects(writeExplainerCaption(facts, 'm', { client: reply(clean.replace('A short hook', 'At Helios, a short hook')) }), (e: unknown) => e instanceof CaptionError && /names Helios/.test(e.message));
  const tooLong = `A short hook that promises more below.\n\n${'word '.repeat(Math.ceil(CAPTION_WRITER_MAX_CHARS / 5))}\n\n#ai #tokens #learn`;
  assert.ok(tooLong.length > CAPTION_WRITER_MAX_CHARS && tooLong.length <= CAPTION_MAX_CHARS);
  await assert.rejects(writeExplainerCaption(facts, 'm', { client: reply(tooLong) }), (e: unknown) => e instanceof CaptionError && /keep it within/.test(e.message));
});
