/**
 * The Helios bank (spec §5.1 Photo chain v1): Helios-designed graphics only,
 * made by Claude Code from the Helios design system and approved once by
 * Tommy. No photos, no hand-picked images: the photo system is fully
 * automatic.
 *
 *   public/social/bank/manifest.json   one entry per graphic (schema below)
 *   public/social/bank/<folder>/…      the image files
 *
 * Today one kind: `stat-background`, the background of stat slides, picked
 * by the 7-day rule (least recently used first; never twice in a post).
 * Whether the set is in use is DESIGNED_GRAPHICS (designed.ts), off until
 * Tommy approves it. Check entries with scripts/social_bank_check.ts.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { Photo } from './find';

export type BankKind = 'stat-background';

export type BankEntry = {
  id: string;
  /** Served path, e.g. "/social/bank/stat/orbit-1.png". */
  url: string;
  kind: BankKind;
  /** Plain keywords for the design (theme, motif); not used for matching. */
  tags: string[];
  /** Always "Helios": Helios-designed, no third-party rights. Shown nowhere (no credit pill). */
  credit: 'Helios';
  width: number;
  height: number;
  addedAt: string;
};

export const BANK_MANIFEST = path.join(process.cwd(), 'public', 'social', 'bank', 'manifest.json');

export async function loadBank(file = BANK_MANIFEST): Promise<BankEntry[]> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as BankEntry[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** What a slide needs from the bank. */
export type BankNeed = { statBackground: true };

export function bankMatches(e: BankEntry, need: BankNeed): boolean {
  return need.statBackground && e.kind === 'stat-background';
}

/** The least recently used matching entry not in `avoid` (this post + the last 7 days + earlier in the run). */
export function pickFromBank(bank: BankEntry[], need: BankNeed, avoid: Set<string>, lastUsed: Map<string, string>): BankEntry | null {
  const fits = bank.filter((e) => bankMatches(e, need) && !avoid.has(e.url));
  fits.sort((a, b) => (lastUsed.get(a.url) ?? '').localeCompare(lastUsed.get(b.url) ?? ''));
  return fits[0] ?? null;
}

/** A designed graphic as the slide's image: no credit pill, no identity. */
export function bankPhoto(e: BankEntry): Photo {
  return { url: e.url, credit: '', source: 'designed', width: e.width, height: e.height, qid: null, subject: null };
}

/** Problems with a manifest entry (the check script). */
export function checkBankEntry(e: BankEntry): string[] {
  const p: string[] = [];
  if (!e.id || !e.url) p.push('id and url are required');
  if (e.kind !== 'stat-background') p.push(`unknown kind "${e.kind}" (the bank holds Helios-designed stat backgrounds only)`);
  if (e.credit !== 'Helios') p.push('credit must be "Helios" (Helios-designed graphics only)');
  if (!e.tags.length) p.push('tags are required');
  return p;
}
