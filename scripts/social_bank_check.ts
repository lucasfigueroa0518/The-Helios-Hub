/**
 * Helios Social — check the photo bank manifest (plan M8c): every entry's
 * fields (bank.ts checkBankEntry), the file is there, its size, and faces
 * from the same browser face detector the render check uses. Offline: no
 * AI calls. --write saves sizes and face results back to the manifest.
 *
 *   npx tsx scripts/social_bank_check.ts [--write]
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { BANK_MANIFEST, checkBankEntry, loadBank } from '@/lib/social/photos/bank';
import { checkRenderFit } from '@/lib/social/render/fit-check';
import type { Post } from '@/lib/social/render/types';

async function main() {
  const write = process.argv.includes('--write');
  const bank = await loadBank();
  if (bank.length === 0) return console.log(`Bank is empty: ${BANK_MANIFEST}`);
  const sharp = (await import('sharp')).default;
  for (const e of bank) {
    const file = path.join(process.cwd(), 'public', e.url);
    try {
      const m = await sharp(await fsp.readFile(file)).metadata();
      e.width = m.width ?? 0;
      e.height = m.height ?? 0;
    } catch {
      console.log(`${e.id}: FILE MISSING ${file}`);
    }
  }
  // Faces: render each photo as a darkened background and read the detector's result.
  const post: Post = {
    format: 'carousel', storyType: 'tech', source: '', sourceUrl: '', publishedAt: '', issueNumber: 0, caption: '',
    slides: bank.map((e, i) => ({ position: i, layoutVariant: 'stat', title: [{ text: '1', role: 'narrative' }], altText: e.id, photoUrl: e.url, photoKind: 'scene' })),
  };
  const fit = await checkRenderFit(post);
  for (const f of fit.focus ?? []) bank[f.slide - 1]!.faces = f.faces.length > 0;
  for (const e of bank) {
    const problems = checkBankEntry(e);
    console.log(`${e.id} [${e.kind}${e.qid ? ` ${e.qid}` : ''}] ${e.width}×${e.height} faces ${e.faces}: ${problems.length ? problems.join('; ') : 'OK'}`);
  }
  if (write) {
    await fsp.writeFile(BANK_MANIFEST, JSON.stringify(bank, null, 2));
    console.log(`\nSaved ${BANK_MANIFEST}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
