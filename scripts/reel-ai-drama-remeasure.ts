/**
 * Re-measures an existing project's pictures in place, free and local (iteration 10; the replay's first step):
 *   npx tsx scripts/reel-ai-drama-remeasure.ts <projectDir>
 * `<projectDir>` holds `assets/inventory.json` (a render project), or `inventory.json` (a job folder). Cutouts are cleaned
 * from the remover's own answer (kept beside them as `.raw.png`), so running it twice gives the same pictures. No model,
 * no network.
 */
import fs from 'node:fs';
import path from 'node:path';

import { measureInventory } from '@/lib/reel-ai-drama/harvest/regions';
import type { VisualsInventory } from '@/lib/reel-ai-drama/types';

export async function remeasure(projectDir: string): Promise<{ inventory: VisualsInventory; notes: string[]; file: string }> {
  const file = [path.join(projectDir, 'assets', 'inventory.json'), path.join(projectDir, 'inventory.json')].find((f) => fs.existsSync(f));
  if (!file) throw new Error(`no inventory.json under ${projectDir}`);
  const inventory = JSON.parse(fs.readFileSync(file, 'utf8')) as VisualsInventory;
  const notes = await measureInventory(inventory, projectDir, { force: true });
  fs.writeFileSync(file, `${JSON.stringify(inventory, null, 2)}\n`);
  return { inventory, notes, file };
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: npx tsx scripts/reel-ai-drama-remeasure.ts <projectDir>');
    process.exit(2);
  }
  const { inventory, notes, file } = await remeasure(path.resolve(dir));
  console.log(`measured ${inventory.assets.length} pictures: ${file}`);
  for (const a of inventory.assets) {
    const r = a.regions;
    if (!r) continue;
    const untrusted = (r.faces ?? []).filter((f) => f.trusted === false);
    const bits = [
      r.cut ? `cut ${r.cut.grade} (soft ${r.cut.edge_softness}, islands ${r.cut.islands}, straight ${r.cut.straight_cuts}, sharp ${r.cut.sharpness})` : '',
      r.dup_of ? `dup of ${r.dup_of}` : '',
      untrusted.length ? `untrusted faces ${untrusted.map((f) => `${f.w}x${f.h}@${f.score}`).join(', ')}` : '',
    ].filter(Boolean);
    if (bits.length) console.log(`${a.id}: ${bits.join('; ')}`);
  }
  for (const n of notes) console.log(n);
}

if (process.argv[1]?.endsWith('reel-ai-drama-remeasure.ts')) void main();
