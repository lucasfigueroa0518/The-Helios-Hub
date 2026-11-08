import { rejectPitchRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reject a pitch by hand ({ note? }). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return rejectPitchRoute(request, context.params);
}
