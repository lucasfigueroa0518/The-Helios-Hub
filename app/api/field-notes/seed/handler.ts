import { NextResponse } from 'next/server';

import type { Query } from '@/lib/media-library/types';
import { PLACEHOLDER_USE, saveSeededLink, type SeededLinkResult } from '@/lib/field-notes/store';
import { canonicalSourceUrl } from '@/lib/field-notes/sources/candidate';
import { CONTENT_LEAVES, WANTS, type ContentLeaf, type Want } from '@/lib/field-notes/types';

/**
 * Seed a Field Notes tip from a source link, the seeder's leaf and want (both required; CONTRACT-v4 section 5),
 * and an optional note. Path per
 * docs/superpowers/specs/2026-10-30-seeding-paths-by-content-type.md: source link first, no model call,
 * no fetch, nothing made and nothing spent. The tip waits as a candidate; the link is read when a person
 * presses Generate. The same source page is one tip (unique index, canonical link), so a repeat is reported, not
 * an error; a rejected or expired tip, or a found one still waiting, becomes this seeder's candidate.
 */
export const NOTE_MAX_CHARS = 1000;
export const URL_MAX_CHARS = 2000;
/** The stand-in for an empty note. It is read by the Writer as the tip's ground truth, so it carries no claim of its own (store.ts keeps the wording). */
export const SEED_USE_PLACEHOLDER = PLACEHOLDER_USE;

export type SeedEnv = {
  session: () => Promise<{ email: string } | null>;
  db: Query;
};

export type SeedResult = SeededLinkResult;

/** An http(s) link without its fragment, or an error message. */
export function normalizeSourceUrl(raw: unknown): { url: string } | { error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'Paste a link to the source.' };
  if (raw.length > URL_MAX_CHARS) return { error: 'That link is too long.' };
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: 'That does not look like a link. Paste the full address, starting with https://.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only http and https links work.' };
  if (u.username || u.password) return { error: 'Remove the user name and password from the link.' };
  u.hash = '';
  return { url: u.toString() };
}

/**
 * Subject guessed from the link alone (no fetch: seeding reads nothing): a GitHub repo is `owner/repo`; any other
 * page is its host plus path, so two different pages on one docs site are different subjects (Tommy, 2026-11-06).
 */
export function guessSubject(url: string): { subject: string; label: string } {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'github.com' && parts.length >= 2) return { subject: `${parts[0]}/${parts[1]}`, label: host };
  return { subject: parts.length ? `${host}/${parts.join('/')}` : host, label: host };
}

export const LEAF_REQUIRED = 'Pick what the link points to.';
export const WANT_REQUIRED = 'Pick what the reader gets from it.';

/** The seeder's leaf and want, or an error message. Both are required and must be known values. */
export function parseLeafWant(leaf: unknown, want: unknown): { leaf: ContentLeaf; want: Want } | { error: string } {
  const l = CONTENT_LEAVES.find((x) => x === leaf);
  if (!l) return { error: LEAF_REQUIRED };
  const w = WANTS.find((x) => x === want);
  if (!w) return { error: WANT_REQUIRED };
  return { leaf: l, want: w };
}

export async function seedRoute(env: SeedEnv, body: unknown): Promise<NextResponse> {
  const session = await env.session();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (body ?? {}) as { url?: unknown; note?: unknown; leaf?: unknown; want?: unknown };
  const link = normalizeSourceUrl(b.url);
  if ('error' in link) return NextResponse.json({ error: link.error }, { status: 400 });
  const tags = parseLeafWant(b.leaf, b.want);
  if ('error' in tags) return NextResponse.json({ error: tags.error }, { status: 400 });
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > NOTE_MAX_CHARS) return NextResponse.json({ error: `Keep the note under ${NOTE_MAX_CHARS} characters.` }, { status: 400 });
  const { subject, label } = guessSubject(canonicalSourceUrl(link.url));
  try {
    // The one seed write (store.saveSeededLink): the link stored canonical; a rejected, expired or found-but-unused tip
    // with it is taken over by this seeder (leaf, want, seeded_by) with its age restarted; anything else is a duplicate.
    const out = await saveSeededLink(env.db, { sourceUrl: link.url, sourceLabel: label, subject, leaf: tags.leaf, want: tags.want, useWithResult: note || SEED_USE_PLACEHOLDER, seededBy: session.email });
    return NextResponse.json(out satisfies SeedResult);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
