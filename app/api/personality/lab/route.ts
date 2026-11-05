import { NextResponse, type NextRequest } from 'next/server';

import { postById, runComment, type Create } from '@/lib/personality/lab';
import { DEPTHS, ENERGIES, ROUTES, type Depth, type Energy, type Route } from '@/lib/personality/prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_COMMENT = 1000;

/** Human-led: each call comes from a click in the comment lab. Nothing is stored or posted. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    postId?: unknown; comment?: unknown; forceRoute?: unknown; forceEnergy?: unknown; forceDepth?: unknown; avoid?: unknown;
  };
  const post = postById(body.postId);
  if (!post) return NextResponse.json({ error: 'Unknown post.' }, { status: 400 });
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, MAX_COMMENT) : '';
  if (!comment) return NextResponse.json({ error: 'Write a comment first.' }, { status: 400 });
  const route = ROUTES.includes(body.forceRoute as Route) ? (body.forceRoute as Route) : null;
  const force = route ? {
    route,
    energy: ENERGIES.includes(body.forceEnergy as Energy) ? (body.forceEnergy as Energy) : undefined,
    depth: DEPTHS.includes(body.forceDepth as Depth) ? (body.forceDepth as Depth) : undefined,
  } : undefined;
  const avoid = Array.isArray(body.avoid) ? body.avoid.filter((x): x is string => typeof x === 'string') : [];

  const { newAnthropic } = await import('@/lib/anthropic-client');
  const client = newAnthropic();
  const create: Create = (params) => client.messages.create(params);

  try {
    return NextResponse.json(await runComment(create, { comment, post, force, avoid }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
