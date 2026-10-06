/**
 * The Helios photo bank (spec §5.1a; plan M8c, Tommy 2026-10-06): photos we
 * may reuse, tagged so reuse stays correct. Local until M9:
 *   public/social/bank/manifest.json   one entry per photo (schema below)
 *   public/social/bank/<folder>/…      the image files
 * Hand-seed path: drop the files in a folder, add their entries with
 * scripts/social_bank_check.ts to validate (fields, files, faces).
 *
 * Reuse rules (spec §5.1a):
 *   - never twice in a post, not used in the last 7 days (the used-photo
 *     log, any source); among matches, the least recently used first;
 *   - person and company photos only for the same verified Wikidata id,
 *     never matched by name;
 *   - company photos never show people (checked by the face detector at
 *     seed time; an entry with faces is skipped);
 *   - event photos only for the same event;
 *   - scenes and stat backgrounds by tag.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { Photo } from './find';

export type BankKind = 'person' | 'company' | 'event' | 'scene' | 'stat-background';

export type BankEntry = {
  id: string;
  /** Served path, e.g. "/social/bank/openai/office.jpg". */
  url: string;
  kind: BankKind;
  /** Person and company photos: the verified Wikidata id they show. */
  qid: string | null;
  /** Event photos: the event they belong to (reused only for it). */
  event: string | null;
  /** Scenes and stat backgrounds: plain keywords ("server room", "office"). */
  tags: string[];
  /** The exact on-slide credit, e.g. "Courtesy of OpenAI" or "Jane Doe (CC0) · Wikimedia Commons". */
  credit: string;
  /** Licence or terms, e.g. "press kit, editorial use", "CC0". */
  licence: string;
  /** Where it came from (press kit page, Commons file page…). */
  source: string;
  width: number;
  height: number;
  /** Face detector result at seed time; company photos must be false. */
  faces: boolean | null;
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
export type BankNeed = { qid: string } | { event: string } | { scene: string };

/** Keyword words, plurals folded ("servers" = "server"). */
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2).map((w) => (w.length > 3 ? w.replace(/s$/, '') : w));

/** Does this entry fit the need, under the reuse rules? */
export function bankMatches(e: BankEntry, need: BankNeed): boolean {
  if ('qid' in need) return (e.kind === 'person' || (e.kind === 'company' && e.faces === false)) && e.qid === need.qid;
  if ('event' in need) return e.kind === 'event' && e.event === need.event;
  const want = new Set(words(need.scene));
  return (e.kind === 'scene' || e.kind === 'stat-background') && e.tags.some((t) => words(t).some((w) => want.has(w)));
}

/** The least recently used matching entry not in `avoid` (this post + the last 7 days). */
export function pickFromBank(bank: BankEntry[], need: BankNeed, avoid: Set<string>, lastUsed: Map<string, string>): BankEntry | null {
  const fits = bank.filter((e) => bankMatches(e, need) && !avoid.has(e.url));
  fits.sort((a, b) => (lastUsed.get(a.url) ?? '').localeCompare(lastUsed.get(b.url) ?? ''));
  return fits[0] ?? null;
}

export function bankPhoto(e: BankEntry): Photo {
  return { url: e.url, credit: e.credit, source: 'bank', width: e.width, height: e.height, qid: e.qid, subject: null };
}

/** Problems with a manifest entry (the seed check). */
export function checkBankEntry(e: BankEntry): string[] {
  const p: string[] = [];
  if (!e.id || !e.url) p.push('id and url are required');
  if (!e.credit.trim()) p.push('credit is required');
  if (!e.licence.trim()) p.push('licence or terms are required');
  if ((e.kind === 'person' || e.kind === 'company') && !/^Q\d+$/.test(e.qid ?? '')) p.push(`${e.kind} photos need the verified Wikidata id (qid)`);
  if (e.kind === 'event' && !e.event) p.push('event photos need the event key');
  if ((e.kind === 'scene' || e.kind === 'stat-background') && e.tags.length === 0) p.push('scenes need tags');
  if (e.kind === 'company' && e.faces !== false) p.push(e.faces ? 'company photo shows a face: not allowed (company photos never show people)' : 'company photo not checked for faces yet');
  if (e.kind === 'scene' && e.faces) p.push('scene shows a face: scenes never show people');
  return p;
}
