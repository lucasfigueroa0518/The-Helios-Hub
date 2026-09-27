import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

import { dbQuery } from '@/lib/db';

/**
 * Serves the render Post JSON for one generated post. DB is source of
 * truth (see `helios_social_render_post_migration.sql`) — on Vercel the
 * filesystem is ephemeral, so writes made by one function invocation
 * don't survive to another. Local dev keeps a filesystem mirror; when
 * the DB lookup misses we fall through to disk so the Playwright export
 * script and older generated fixtures still work.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  // Prevent directory traversal — slugs are the safe subset [a-z0-9-].
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  }

  // Primary: DB lookup.
  try {
    const { rows } = await dbQuery<{ render_post_json: unknown }>(
      `SELECT render_post_json
         FROM helios_social.article_queue
        WHERE render_slug = $1
        LIMIT 1`,
      [slug],
    );
    if (rows[0]?.render_post_json) {
      return NextResponse.json(rows[0].render_post_json, {
        headers: { 'cache-control': 'no-store' },
      });
    }
  } catch (err) {
    // Fall through to filesystem — DB might not be reachable in some
    // dev configurations, and older fixtures live on disk anyway.
    void err;
  }

  // Fallback: filesystem.
  const filePath = path.join(process.cwd(), 'exports', 'social', 'generated', `${slug}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return NextResponse.json(parsed, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return NextResponse.json({ error: 'not found', slug }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'read failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
