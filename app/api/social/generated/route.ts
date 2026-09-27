import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

import { dbQuery } from '@/lib/db';

/**
 * Lists every generated Post's slug. DB is source of truth, filesystem
 * is a dev-only mirror — see `[slug]/route.ts` for the same pattern on
 * the read side. Union the two sources so old fixtures on disk stay
 * discoverable in local dev.
 */
export async function GET(): Promise<Response> {
  const slugs = new Set<string>();

  try {
    const { rows } = await dbQuery<{ render_slug: string }>(
      `SELECT render_slug
         FROM helios_social.article_queue
        WHERE render_slug IS NOT NULL
        ORDER BY added_at DESC`,
    );
    for (const row of rows) if (row.render_slug) slugs.add(row.render_slug);
  } catch {
    // DB unavailable — fall through, filesystem still gets scanned.
  }

  const dir = path.join(process.cwd(), 'exports', 'social', 'generated');
  try {
    const entries = await fs.readdir(dir);
    for (const f of entries) {
      if (!f.endsWith('.json')) continue;
      slugs.add(f.replace(/\.json$/, ''));
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') {
      return NextResponse.json(
        { error: 'read failed', message: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { slugs: [...slugs].sort() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
