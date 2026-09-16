'use server';

import { revalidatePath } from 'next/cache';

import { dbQuery } from '@/lib/db';
import { requireSocialSession } from '@/lib/social/session';

export type AddToQueueInput = {
  sourceUrl: string;
  source: string;
  headline: string;
  body: string;
};

/**
 * Inserts one article into the team-wide queue. Silently no-ops on duplicate
 * `source_url` (UNIQUE in schema) — the caller can rely on the queue view
 * re-rendering to reflect the current state either way.
 */
export async function addToQueue(input: AddToQueueInput): Promise<void> {
  const session = await requireSocialSession();

  const sourceUrl = input.sourceUrl?.trim();
  const source = input.source?.trim();
  const headline = input.headline?.trim();
  const body = input.body?.trim();

  if (!sourceUrl) throw new Error('Source URL is required');
  if (!source) throw new Error('Outlet name is required');
  if (!headline) throw new Error('Headline is required');
  if (!body) throw new Error('Article body is required');

  try {
    new URL(sourceUrl);
  } catch {
    throw new Error('Source URL must be a valid URL (include https://…)');
  }

  await dbQuery(
    `INSERT INTO helios_social.article_queue (source, source_url, headline, body, added_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_url) DO NOTHING`,
    [source, sourceUrl, headline, body, session.userId],
  );

  revalidatePath('/social');
}
