import { NextResponse } from 'next/server';

export type FieldNotesTipMakeEnv = {
  session: () => Promise<{ email: string } | null>;
  /** lib/field-notes/manual.ts queueTipFieldNotesRun: queues one run that puts this tip first, or says why not. */
  make: (email: string, tipId: string) => Promise<{ ok: boolean; note: string; capUsd: number | null }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Make it on one Field Notes tip, with the session and the queueing injected so the guard is testable offline. The same
 * shape as Explainers' `/api/explainers/topics/:id/generate`: no session is a 401 and a malformed id a 404, before
 * anything is read or queued; a refusal (archived, used, the cap not set, a run already queued or running) is a 409 with
 * its note. The app never runs a post itself: the social worker claims the queued run.
 */
export async function fieldNotesTipMakeRoute(env: FieldNotesTipMakeEnv, tipId: string): Promise<NextResponse> {
  const session = await env.session();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!UUID.test(tipId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const out = await env.make(session.email, tipId.toLowerCase());
    if (!out.ok) return NextResponse.json({ error: out.note, capUsd: out.capUsd }, { status: 409 });
    return NextResponse.json({ queued: true, note: out.note, capUsd: out.capUsd });
  } catch (error) {
    console.error('[field-notes/tips/make] queue failed', error);
    return NextResponse.json({ error: 'Couldn\u2019t start the run. Try again.' }, { status: 500 });
  }
}
