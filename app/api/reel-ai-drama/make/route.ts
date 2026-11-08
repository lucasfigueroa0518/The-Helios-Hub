import { makeRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lucas's Make click: queues one production job for the worker (capped per reel). The click is the approval. */
export async function POST(request: Request) {
  return makeRoute(request);
}
