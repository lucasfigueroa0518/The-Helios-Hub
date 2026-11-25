import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { BankedCutout } from '@/lib/real-case/bank';

/**
 * The bank identity check (MD-81). Banked cutouts were approved by eye but never compared with a verified
 * picture of the person (Amodei's cutout did not look like him). `scripts/reel_ai_drama_check_bank.ts`
 * compares each one with a Wikidata/Commons portrait and writes the verdicts here; the harvest skips a
 * banked cutout whose verdict is `different`. Reel AI Drama's own file: the Real Case bank is never edited.
 */

export const BANK_VERDICTS_FILE = path.join('explainers', 'reel-ai-drama', 'kit', 'bank-verdicts.json');

export type BankVerdictValue = 'same' | 'different' | 'unsure';

export type BankVerdict = {
  /** The banked cutout's id. */
  id: string;
  name: string;
  qid: string;
  verdict: BankVerdictValue;
  /** One plain sentence from the vision call. */
  reason: string;
  /** The Commons file the cutout was compared with. */
  reference: string | null;
  /** sha256 of the cutout file that was checked: a re-made cutout is not judged by an old verdict. */
  sha256: string;
  model: string;
  checked_at: string;
};

export type BankVerdicts = { verdicts: BankVerdict[] };

export function loadBankVerdicts(root: string = process.cwd()): BankVerdicts {
  const file = path.join(root, BANK_VERDICTS_FILE);
  if (!fs.existsSync(file)) return { verdicts: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<BankVerdicts>;
    return { verdicts: Array.isArray(parsed.verdicts) ? parsed.verdicts : [] };
  } catch {
    // An unreadable verdict file never stops a harvest (MD-65): every cutout stays usable.
    return { verdicts: [] };
  }
}

export const fileSha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** The cutout's verdict when one was recorded for this exact file, else null. */
export function verdictFor(cutout: Pick<BankedCutout, 'id' | 'file'>, verdicts: BankVerdicts, root: string = process.cwd()): BankVerdict | null {
  const v = verdicts.verdicts.find((x) => x.id === cutout.id);
  if (!v) return null;
  try {
    return fileSha256(path.resolve(root, cutout.file)) === v.sha256 ? v : null;
  } catch {
    return null;
  }
}

/** The banked cutouts the harvest may use: everything except a cutout checked and found to be someone else. */
export function trustedCutouts<T extends Pick<BankedCutout, 'id' | 'file'>>(cutouts: readonly T[], root: string = process.cwd(), verdicts: BankVerdicts = loadBankVerdicts(root)): T[] {
  if (!verdicts.verdicts.some((v) => v.verdict === 'different')) return [...cutouts];
  return cutouts.filter((c) => verdictFor(c, verdicts, root)?.verdict !== 'different');
}
