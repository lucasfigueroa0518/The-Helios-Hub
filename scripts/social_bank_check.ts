/**
 * Helios Social — check the bank manifest (spec §5.1 Photo chain v1: Helios-
 * designed stat backgrounds only): every entry's fields (bank.ts
 * checkBankEntry), the file is there, and its size. Offline: no AI calls.
 * --write saves sizes back to the manifest.
 *
 *   npx tsx scripts/social_bank_check.ts [--write]
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { BANK_MANIFEST, checkBankEntry, loadBank } from '@/lib/social/photos/bank';

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
    const problems = checkBankEntry(e);
    console.log(`${e.id} [${e.kind}] ${e.width}×${e.height} ${e.tags.join(', ')}: ${problems.length ? problems.join('; ') : 'OK'}`);
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
