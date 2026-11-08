import { developRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Develop click: queues one development session for the worker (202). No model runs in this request. */
export async function POST(request: Request) {
  return developRoute(request);
}
