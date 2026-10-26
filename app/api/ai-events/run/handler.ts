import { NextResponse } from 'next/server';

export type AiEventsRunEnv = {
  session: () => Promise<{ email: string } | null>;
  run: (email: string) => Promise<{ queued: boolean; note: string }>;
};

/**
 * Generate on the AI Events page, with its session read and run injected so
 * the guard is testable offline. Same auth as the Last Few Days run route: no
 * session is a 401 before anything runs.
 */
export async function aiEventsRunRoute(env: AiEventsRunEnv): Promise<NextResponse> {
  const session = await env.session();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await env.run(session.email));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
