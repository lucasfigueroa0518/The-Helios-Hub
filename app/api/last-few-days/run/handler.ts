import { NextResponse } from 'next/server';

export type LfdRunEnv = {
  session: () => Promise<{ email: string } | null>;
  run: (email: string) => Promise<{ queued: boolean; note: string }>;
};

/**
 * "Make Last Few Days now", with its session read and run injected so the
 * guard is testable offline. Same auth as the carousels run route: no session
 * is a 401 before anything runs.
 */
export async function lfdRunRoute(env: LfdRunEnv): Promise<NextResponse> {
  const session = await env.session();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await env.run(session.email));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
