import { NextResponse } from 'next/server';

import { CapError } from '@/lib/news-ranker/lab/cost';
import { deleteTag, saveTag } from '@/lib/news-ranker/lab/db';
import { freezeSet, intakeUrl, readOnly } from '@/lib/news-ranker/lab/freeze';
import { readDigests } from '@/lib/news-ranker/lab/digests';
import { labDb, liveDeps } from '@/lib/news-ranker/lab/live';
import { labState } from '@/lib/news-ranker/lab/results';
import { planRun, runVariant } from '@/lib/news-ranker/lab/runner';
import { isVariantId } from '@/lib/news-ranker/lab/variants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function allowed(): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') return true;
  const { getSession } = await import('@/lib/session');
  return Boolean(await getSession());
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(req: Request) {
  if (!(await allowed())) return fail('Unauthorized', 401);
  const setId = new URL(req.url).searchParams.get('set');
  return NextResponse.json({ ...(await labState(await labDb(), setId)), digests: readDigests() });
}

/** Actions: tag, untag, freeze, plan, run. Only `run` makes live calls; it re-checks the $1 cap itself. */
export async function POST(req: Request) {
  if (!(await allowed())) return fail('Unauthorized', 401);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = await labDb();
  try {
    switch (body.action) {
      case 'tag':
        if (typeof body.storyId !== 'string') return fail('storyId required');
        if (!rating(body.cool) || !rating(body.needToKnow)) return fail('cool and needToKnow must be integers 0–10');
        await saveTag(db, { storyId: body.storyId, cool: body.cool as number, needToKnow: body.needToKnow as number, note: typeof body.note === 'string' && body.note ? body.note : undefined });
        return NextResponse.json({ ok: true });
      case 'untag':
        if (typeof body.storyId !== 'string') return fail('storyId required');
        await deleteTag(db, body.storyId);
        return NextResponse.json({ ok: true });
      case 'freeze': {
        const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : undefined;
        const set = await readOnly(intakeUrl(), (q) => freezeSet(db, q, new Date(), ids ? { ids, days: 35, prefix: 'picks' } : {}));
        return NextResponse.json({ setId: set.id, stories: set.stories.length });
      }
      case 'plan':
      case 'run': {
        if (typeof body.setId !== 'string' || typeof body.variantId !== 'string' || !isVariantId(body.variantId)) return fail('setId and a known variantId required');
        if (body.action === 'plan') return NextResponse.json(await planRun(db, body.setId, body.variantId));
        return NextResponse.json(await runVariant(db, liveDeps(), body.setId, body.variantId));
      }
      default:
        return fail('unknown action');
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), err instanceof CapError ? 402 : 500);
  }
}

const rating = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 10;
