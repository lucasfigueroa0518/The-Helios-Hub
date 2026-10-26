import { NextResponse } from 'next/server';

export type PoolAction = 'pin' | 'exclude' | 'clear' | 'rebuild';

export type AiEventsPoolEnv = {
  session: () => Promise<{ email: string } | null>;
  /** lib/ai-events/pool.ts: pin, exclude or clear one event for the coming week, or queue Rebuild post. */
  act: (action: PoolAction, email: string, eventId: string | null) => Promise<{ ok: boolean; note: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: readonly PoolAction[] = ['pin', 'exclude', 'clear', 'rebuild'];

/** `{ action, eventId }` (pin, exclude, clear) or `{ action: 'rebuild' }`; null when malformed. */
export function parsePoolBody(body: unknown): { action: PoolAction; eventId: string | null } | null {
  const b = body as { action?: unknown; eventId?: unknown } | null;
  if (!b || typeof b !== 'object' || !ACTIONS.includes(b.action as PoolAction)) return null;
  const action = b.action as PoolAction;
  if (action === 'rebuild') return b.eventId === undefined ? { action, eventId: null } : null;
  return typeof b.eventId === 'string' && UUID.test(b.eventId) ? { action, eventId: b.eventId.toLowerCase() } : null;
}

/**
 * The AI Events pool's controls (AE-04), with the session and the pool
 * actions injected so the guard is testable offline. No session is a 401 and
 * a malformed body a 400, before anything is written. A refused action
 * (the event isn't in the cities, a run is already queued) is a 409 with
 * its note. Rebuild post queues a run; nothing here runs one.
 */
export async function aiEventsPoolRoute(env: AiEventsPoolEnv, body: unknown): Promise<NextResponse> {
  const session = await env.session();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = parsePoolBody(body);
  if (!parsed) return NextResponse.json({ error: 'Expected { action: pin | exclude | clear, eventId } or { action: rebuild }.' }, { status: 400 });
  try {
    const out = await env.act(parsed.action, session.email, parsed.eventId);
    return NextResponse.json(out, { status: out.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
