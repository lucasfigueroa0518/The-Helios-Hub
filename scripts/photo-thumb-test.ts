/** Lab: Jev's thumbnail question (and the old overlay question) on every trial image. ~$0.015. Run with --yes. */
import fs from 'node:fs';
import path from 'node:path';

import { image, noul, TypeSafeClient, type Questions } from '@typesafe-ai/sdk';

import { jevCostUsd } from '@/lib/social/jev/client';

import { PHOTO_QUESTIONS } from './photo-vision-test';

const LAB = path.join(process.cwd(), '.memes-local/news-ranker-lab');
const all: string[] = JSON.parse(fs.readFileSync(path.join(LAB, 'thumbs/all.json'), 'utf8'));

async function main() {
  if (!process.argv.includes('--yes')) return console.log('add --yes');
  const jev = new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } });
  const out: Record<string, { thumbnail: number; overlay: number }> = {};
  let cost = 0;
  const q = [...all];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let f = q.shift(); f; f = q.shift()) {
      try {
        const res = await jev.systemOne({ state: image(fs.readFileSync(path.join(LAB, 'md-trial', f))), questions: {
          thumbnail: noul(PHOTO_QUESTIONS.thumbnail, { true: 'A click-bait thumbnail graphic', false: 'A photo, screenshot or plain image' }),
          overlay: noul(PHOTO_QUESTIONS.overlay, { true: 'Carries a watermark, channel logo or another outlet’s text', false: 'Clean' }),
        } as unknown as Questions } as never);
        cost += jevCostUsd({ input_tokens: res.usage.input_tokens ?? 0, output_tokens: res.usage.output_tokens ?? 0 });
        const a = res.answers as Record<string, { noul: number }>;
        out[f] = { thumbnail: a.thumbnail!.noul, overlay: a.overlay!.noul };
      } catch (e) { console.error(`skip ${f}: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
    }
  }));
  const ledger = path.join(LAB, 'tourney/ledger.json');
  const l = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  l.spent += cost; l.runs.push({ spec: 'thumbnail jev', cost, at: new Date().toISOString() });
  fs.writeFileSync(ledger, JSON.stringify(l, null, 1));
  fs.writeFileSync(path.join(LAB, 'thumbs/jev.json'), JSON.stringify({ costUsd: cost, results: out }, null, 1));
  console.log(`${Object.keys(out).length}/${all.length}, $${cost.toFixed(4)}, thumbnail yes ${Object.values(out).filter((x) => x.thumbnail >= 0.5).length}`);
}
main();
