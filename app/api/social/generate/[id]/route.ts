import { NextResponse } from 'next/server';

import { adjustPostFromCritique, generatePostForArticle } from '@/lib/social/pipeline/generate';
import { requireSocialSession } from '@/lib/social/session';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Manual trigger — user clicks a button on an article card in the /social UI.
 *
 * Body shapes:
 *   `{}`                            — resume-default (skip cached stages)
 *   `{ force: true }`               — regenerate from scratch (advanced)
 *   `{ critique: "make it tighter" }` — smart-adjust based on user feedback
 *                                       (reads existing copy, reshapes per critique)
 *
 * Returns `{ slug, cost_usd, stages_run, preview_url }` or an error.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await requireSocialSession();

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid article id' }, { status: 400 });
  }

  let body: { force?: boolean; critique?: string } = {};
  try {
    body = (await req.json()) as typeof body ?? {};
  } catch {
    // Empty body is fine — treat as resume-default.
  }

  const result = typeof body.critique === 'string' && body.critique.trim().length > 0
    ? await adjustPostFromCritique(id, body.critique)
    : await generatePostForArticle(id, { force: Boolean(body.force) });

  if (!result.ok) {
    const status = result.code === 'not_found' ? 404
      : result.code === 'hook_gate_failed' ? 422
      : 400;
    return NextResponse.json({ error: result.message, detail: result.detail }, { status });
  }

  return NextResponse.json({
    slug: result.slug,
    cost_usd: result.cost_usd,
    stages_run: result.stages_run,
    preview_url: result.preview_url,
  });
}
