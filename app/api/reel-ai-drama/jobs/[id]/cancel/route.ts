import { cancelJobRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancel a job: a queued one is killed, a running one stops at its next stage. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return cancelJobRoute(request, context.params);
}
