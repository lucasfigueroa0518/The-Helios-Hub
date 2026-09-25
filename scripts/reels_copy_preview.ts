/**
 * Print the assembled P-10 writer prompt for the latest slate's selected
 * ideas, without calling any model. For reviewing the prompt before approval.
 *
 *   npm run reels:copy-preview            # writes tmp/reels-copy-preview/*.md
 *   npm run reels:copy-preview -- --stdout
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { assembleCopyPrompt } from '@/lib/reels/copy/assemble';
import { loadCopyTargets } from '@/lib/reels/copy/store';
import { loadLatestSlate } from '@/lib/reels/scoring/store';

/** Rough, for scale only: about four characters per token in English prose. */
function approxTokens(chars: number): number {
  return Math.round(chars / 4);
}

async function main(): Promise<void> {
  const slate = await loadLatestSlate();
  if (!slate) {
    console.log('No slate yet.');
    return;
  }
  const targets = await loadCopyTargets(slate.id);
  const toStdout = process.argv.includes('--stdout');
  const dir = path.resolve(__dirname, '..', 'tmp', 'reels-copy-preview');
  if (!toStdout) mkdirSync(dir, { recursive: true });

  for (const target of targets) {
    const prompt = assembleCopyPrompt(target);
    const [staticBlock, strategyBlock] = prompt.system;
    const user = String(prompt.messages[0].content);
    const doc = [
      `<!-- ${prompt.version} · slate ${slate.nyDate} · rank ${target.rank} · ${target.bucket} · ${target.framework} -->`,
      '',
      '<!-- SYSTEM BLOCK 1 (cached, shared by every idea) -->',
      staticBlock.text,
      '',
      '<!-- SYSTEM BLOCK 2 (cached per bucket and framework) -->',
      strategyBlock.text,
      '',
      '<!-- USER TURN (per idea, not cached) -->',
      user,
    ].join('\n');

    const sizes = {
      rank: target.rank,
      bucket: target.bucket,
      framework: target.framework,
      members: target.members.length,
      staticTokens: approxTokens(staticBlock.text.length),
      strategyTokens: approxTokens(strategyBlock.text.length),
      userTokens: approxTokens(user.length),
    };
    if (toStdout) {
      console.log(doc);
    } else {
      const file = path.join(dir, `rank-${target.rank ?? 'x'}-${target.bucket}.md`);
      writeFileSync(file, doc);
      console.log(JSON.stringify({ file: path.relative(process.cwd(), file), ...sizes }));
    }
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
