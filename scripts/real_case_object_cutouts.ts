/**
 * Object prep for one AI News Explained plan (planning/Real Case Reels/DECISIONS.md RC-52), by hand.
 *
 *   npx tsx scripts/real_case_object_cutouts.ts --plan <STORYBOARD.md> --project <dir> [--no-vision]
 *
 * What a render job does after its plan is final: the plan's `## Case file` objects become photo
 * cutouts (board, newspaper) and marker drawings (whiteboard), cutout players on a whiteboard act get
 * a sketch banked for approval, all from the object bank when it has them. --no-vision skips stock
 * (which needs the Haiku pick) and goes straight to a generated studio photo, for runs that may not
 * call Claude. Drawings and photos cost money (gpt-image-2, about $0.05 each); the total is printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

import { prepareJobObjects } from '@/lib/real-case/objects/prepare';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const planFile = arg('--plan');
  const project = arg('--project');
  if (!planFile || !project) throw new Error('usage: --plan <STORYBOARD.md> --project <dir> [--no-vision]');
  const create = args.includes('--no-vision') ? null : (p: Anthropic.MessageCreateParamsNonStreaming) => new Anthropic().messages.create(p);
  const r = await prepareJobObjects(path.resolve(project), fs.readFileSync(planFile, 'utf8'), { create, log: (e, d) => console.log(e, JSON.stringify(d)) });
  for (const p of r.placed) console.log(`placed ${p.file} — ${p.credit} (${p.license})`);
  for (const f of r.flags) console.log(`flag: ${f}`);
  console.log(`cost: images $${r.usd.drawing.toFixed(3)}, vision $${r.usd.vision.toFixed(4)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
