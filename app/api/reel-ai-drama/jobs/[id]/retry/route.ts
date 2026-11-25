import { retryJobRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Retry a failed job under its own id. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return retryJobRoute(request, context.params);
}
