import { revivePitchRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bring a rejected, retired or killed pitch back to the pool. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return revivePitchRoute(request, context.params);
}
