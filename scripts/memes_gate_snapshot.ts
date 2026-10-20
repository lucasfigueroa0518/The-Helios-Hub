/**
 * Freeze the gate's evidence for production (lib/memes/lfd-post.ts): every graded story the lab's gate counts
 * (odds-store.ts oddsRows: the current regime and its declared equivalents, the current tagger version), plus
 * the gate threshold in force, written to lib/memes/gate-evidence.generated.json. Production grades nothing, so
 * its odds only change when this is re-run after more grading in the lab, and the result is shipped.
 *
 * Reads a copy of the lab's database (the running lab keeps its own). Offline; no model calls.
 *
 *   npx tsx scripts/memes_gate_snapshot.ts [--data <path to .memes-local/pgdata>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openLocalMemesDb } from '@/lib/memes/db';
import { getSettings, oddsRows } from '@/lib/memes/odds-store';
import { cellTable, fitOdds } from '@/lib/memes/odds';
import { regimeId } from '@/lib/memes/regime';
import { TAGGER_VERSION } from '@/lib/memes/story-tags';

async function main() {
  const argv = process.argv.slice(2);
  const src = argv.indexOf('--data') >= 0 ? argv[argv.indexOf('--data') + 1]! : path.join(process.cwd(), '.memes-local', 'pgdata');
  if (!fs.existsSync(src)) throw new Error(`No lab database at ${src}`);
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'memes-gate-snapshot-'));
  fs.cpSync(src, copy, { recursive: true });
  try {
    const { db, pg } = await openLocalMemesDb(copy);
    const regime = regimeId();
    const rows = await oddsRows(db, regime);
    const { gateThreshold } = await getSettings(db);
    await pg.close();
    const out = { regime, taggerVersion: TAGGER_VERSION, threshold: gateThreshold, createdAt: new Date().toISOString(), rows: rows.map((r) => ({ storyId: r.storyId, tags: r.tags, anyGood: r.anyGood })) };
    const dest = path.join(process.cwd(), 'lib', 'memes', 'gate-evidence.generated.json');
    fs.writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`);
    const model = fitOdds(out.rows);
    console.log(`${rows.length} graded stories (regime ${regime}, ${TAGGER_VERSION}), threshold ${gateThreshold}. Wrote ${dest}`);
    for (const c of cellTable(model)) {
      const last = c.odds.chain[c.odds.chain.length - 1]!;
      console.log(`  ${c.traits.irony ? 'irony/launch' : 'neither     '} ${c.traits.numberStory ? 'number ' : 'other  '} ${c.traits.shortHeadline ? 'short' : 'long '}  ${last.good}/${last.n}  ${(100 * c.odds.p).toFixed(1)}%`);
    }
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
