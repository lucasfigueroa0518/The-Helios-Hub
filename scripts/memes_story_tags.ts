/**
 * Tag the graded stories with the Jev story tagger (lib/memes/story-tags.ts)
 * and check the tags against Claude's deep-read codes
 * (.memes-local/predict/story-codes-2026-10-19.json), which the tagger's
 * wording is calibrated to, never against grades.
 *
 * Writes .memes-local/predict/story-tags-<tagger version>.json. The lab loads
 * that file into memes.story_tags when it opens its database (a seed: the
 * odds start from these tags).
 *
 * Live Jev calls, one per story (about $0.003 for 79), capped at $0.05.
 *
 *   npx tsx scripts/memes_story_tags.ts [--eval <file>]
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadEnvConfig } from '@next/env';

import { latestEvalFile, loadEvalSet } from '@/lib/memes/eval';
import { storyTagsSeedPath } from '@/lib/memes/odds-store';
import { STORY_TAGS, tagStories, TAGGER_VERSION, type StoryTags } from '@/lib/memes/story-tags';
import { capped, createJevAsk, createJevTally, tallied } from '@/lib/social/jev/client';

loadEnvConfig(process.cwd());


async function main() {
  const argv = process.argv.slice(2);
  const file = (argv.indexOf('--eval') >= 0 ? argv[argv.indexOf('--eval') + 1] : undefined) ?? latestEvalFile();
  if (!file) throw new Error('No eval export; run scripts/memes_eval_export.ts');
  const set = loadEvalSet(file);
  const v5 = new Set(set.runs.filter((r) => r.pipeline === 'v5').flatMap((r) => r.storyIds));
  const stories = set.stories.filter((s) => v5.has(s.id) && s.brief);
  const tally = createJevTally();
  const jev = capped(tallied(createJevAsk(), tally), tally, 0.05);
  const tags = await tagStories(jev, stories.map((s) => ({ id: s.id, headline: s.headline, text: s.brief!.the_news?.text ?? '' })));

  const codesFile = path.join(process.cwd(), '.memes-local', 'predict', 'story-codes-2026-10-19.json');
  if (fs.existsSync(codesFile)) {
    const codes = (JSON.parse(fs.readFileSync(codesFile, 'utf8')) as { codes: Record<string, { arch: string; irony: number; number: number; conflict: number }> }).codes;
    const checks: Array<[string, (t: StoryTags) => boolean, (c: { arch: string; irony: number; number: number; conflict: number }) => boolean]> = [
      ['irony', (t) => t.irony, (c) => c.irony >= 1],
      ['launch', (t) => t.launch, (c) => c.arch === 'launch'],
      ['numberStory', (t) => t.numberStory, (c) => c.number === 1],
      ['conflict', (t) => t.conflict, (c) => c.conflict === 1],
    ];
    console.log(`Agreement with Claude's deep-read codes (${STORY_TAGS.version}):`);
    for (const [name, mine, theirs] of checks) {
      let agree = 0;
      let n = 0;
      let both = 0;
      let onlyJev = 0;
      let onlyClaude = 0;
      for (const [id, t] of tags) {
        const c = codes[id];
        if (!c) continue;
        n += 1;
        const a = mine(t);
        const b = theirs(c);
        if (a === b) agree += 1;
        if (a && b) both += 1;
        else if (a) onlyJev += 1;
        else if (b) onlyClaude += 1;
      }
      console.log(`  ${name.padEnd(12)} ${agree}/${n} (${Math.round((100 * agree) / (n || 1))}%)  both ${both}, Jev only ${onlyJev}, Claude only ${onlyClaude}`);
    }
  }
  const dest = storyTagsSeedPath(TAGGER_VERSION);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify({ version: TAGGER_VERSION, file, jev: { calls: tally.calls, costUsd: tally.costUsd }, tags: Object.fromEntries(tags) }, null, 1));
  console.log(`Tagged ${tags.size} stories; Jev ${tally.calls} calls, $${tally.costUsd.toFixed(4)}. Wrote ${dest}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
