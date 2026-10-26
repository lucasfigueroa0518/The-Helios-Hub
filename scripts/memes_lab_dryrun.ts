/**
 * Meme lab dry run (BUILD_PLAN M5): one Generate end to end with the real
 * renderer and a throwaway database, but canned Claude and Jev answers on the
 * test fixture story. No live call, no spend (CLAUDE.md Rule 1).
 *
 *   npx tsx scripts/memes_lab_dryrun.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { getRun } from '@/lib/memes/api';
import { openLocalMemesDb } from '@/lib/memes/db';
import { openMemeRenderer } from '@/lib/memes/render';
import { processNextRequest } from '@/lib/memes/run';
import type { JevAsk } from '@/lib/social/jev/client';

import { answerAll, cannedMessage, FIXTURE_STORY, GOOD_MEMES } from '../tests/fixtures/memes';

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memes-dryrun-'));
  const renderDir = path.join(process.cwd(), '.memes-local', 'dryrun');
  const { db, pg } = await openLocalMemesDb(path.join(tmp, 'pg'));
  const renderer = await openMemeRenderer();
  const jev: JevAsk = answerAll();
  try {
    const { rows } = await db.query<{ id: string }>(`INSERT INTO memes.requests (kind, post_id, requested_by) VALUES ('single', $1, 'dryrun') RETURNING id`, [FIXTURE_STORY.postId]);
    await processNextRequest({
      db, renderer, jev, renderDir,
      create: (async () => cannedMessage({ story_shape: 'A free plan gets a cap.', memes: GOOD_MEMES })) as unknown as (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>,
      loadStory: async () => FIXTURE_STORY,
    });
    const run = await getRun(db, rows[0]!.id);
    console.log(`status ${run.status}${run.error ? ` (${run.error})` : ''}, canned cost $${run.costUsd.toFixed(4)}`);
    for (const m of run.memes) console.log(`  ${m.inSlate ? `#${m.rank}` : '  '} ${m.templateName}: ${m.dropped ?? 'in slate'}`);
    console.log(`images: ${renderDir}`);
  } finally {
    await renderer.close();
    await pg.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
