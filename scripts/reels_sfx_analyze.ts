/**
 * Stage 1 of the hook sound plan. Reads every source WAV and writes one
 * analysis record per file. Changes no audio, calls nothing paid.
 *
 *   npx tsx scripts/reels_sfx_analyze.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { analyzeSource } from '@/lib/reels/sfx/analyze';
import { readWav } from '@/lib/reels/sfx/wav';

const SOURCE_DIR = path.join('planning', 'Trial Reels', 'SFX candidates');
const OUT_PATH = path.join('lib', 'reels', 'sfx', 'analysis.json');

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width);
}

const files = fs
  .readdirSync(SOURCE_DIR)
  .filter((name) => name.toLowerCase().endsWith('.wav'))
  .sort();
if (files.length === 0) throw new Error(`No WAV files in ${SOURCE_DIR}.`);

const records = files.map((name) => analyzeSource(name, readWav(fs.readFileSync(path.join(SOURCE_DIR, name)))));

fs.writeFileSync(
  OUT_PATH,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), sourceDir: SOURCE_DIR, sources: records })}\n`,
);

console.log(
  `${pad('File', 24)}${pad('Length', 10)}${pad('Peak', 9)}${pad('Env pk', 9)}${pad('Audible', 16)}${pad('RMS', 8)}Bursts`,
);
for (const record of records) {
  const audible = record.audible ? `${Math.round(record.audible.startMs)}–${Math.round(record.audible.endMs)} ms` : 'silent';
  console.log(
    pad(record.file.replace(/\.wav$/i, ''), 24) +
      pad(`${(record.durationMs / 1000).toFixed(3)} s`, 10) +
      pad(record.samplePeakDb.toFixed(1), 9) +
      pad(record.envelopePeakDb.toFixed(1), 9) +
      pad(audible, 16) +
      pad(record.audibleRmsDb?.toFixed(1) ?? '—', 8) +
      `${record.bursts.length} (${record.bursts.map((burst) => `${burst.startMs}–${Math.round(burst.endMs)}`).join(', ')})`,
  );
}
console.log(`\nWrote ${records.length} records to ${OUT_PATH}`);
