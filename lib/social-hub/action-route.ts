import { revalidateTag } from 'next/cache';

import { actionEnabled, SOCIAL_HUB_FLAGS, type ActionFlag, type HubFlags } from '@/lib/social-hub/flags';
import { getSession } from '@/lib/session';

/**
 * Flag-gated action routes (BUILD_PLAN §S1.5, §S5). The flag is checked
 * first: while it is off the route answers 404 and does nothing else (no
 * session read, no body read, no call). When on, it needs a session and a
 * valid body, then calls one existing exported pipeline function through
 * `run`. Dependencies are injected so tests can stub them.
 */

export type ActionResult = { ok: boolean; note?: string; status?: number };

export type ActionSpec<B> = {
  flag: ActionFlag;
  parse: (body: unknown) => B | null;
  run: (body: B, ctx: { email: string }) => Promise<ActionResult>;
};

export type ActionEnv = {
  flags?: HubFlags;
  session?: () => Promise<{ email: string } | null>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function actionRoute<B>(spec: ActionSpec<B>, env: ActionEnv = {}): (req: Request) => Promise<Response> {
  return async function POST(req: Request): Promise<Response> {
    if (!actionEnabled(spec.flag, env.flags ?? SOCIAL_HUB_FLAGS)) {
      return Response.json({ ok: false, note: 'This action is turned off.' }, { status: 404 });
    }
    const session = await (env.session ?? getSession)();
    if (!session) return Response.json({ ok: false, note: 'Unauthorized' }, { status: 401 });
    // JSON only: a plain cross-site form post can't send it (on top of SameSite=Lax cookies).
    if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return Response.json({ ok: false, note: 'Send JSON.' }, { status: 415 });
    }
    const body = spec.parse(await req.json().catch(() => null));
    if (!body) return Response.json({ ok: false, note: 'Bad request' }, { status: 400 });
    try {
      const result = await spec.run(body, { email: session.email });
      if (result.ok) refreshHubData();
      return Response.json(result, { status: result.status ?? (result.ok ? 200 : 409) });
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 500;
      return Response.json({ ok: false, note: error instanceof Error ? error.message : String(error) }, { status });
    }
  };
}

/** The hub's shared read is cached for a minute (views/cached-dataset.ts); an action makes it stale at once. */
function refreshHubData(): void {
  try {
    revalidateTag('social-hub:data');
  } catch {
    // Outside a Next request (tests) there is no cache to revalidate.
  }
}
