import { NextResponse } from 'next/server';

export type FieldNotesRunEnv = {
  session: () => Promise<{ email: string } | null>;
  /** Queues one `requested` field_notes.runs row (or answers a note when one is already queued or running). */
  run: (email: string) => Promise<{ queued: boolean; note: string }>;
};

/**
 * Generate on the Field Notes page, with its session read and run injected so the guard is testable
 * offline. Same shape as the AI Events run route: no session is a 401 before anything runs; a second
 * click while a run is queued answers `queued: false` with a note, not an error.
 */
export async function fieldNotesRunRoute(env: FieldNotesRunEnv): Promise<NextResponse> {
  const session = await env.session();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await env.run(session.email));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
