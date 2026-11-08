import { dramaArtifactResponse } from '@/lib/reel-ai-drama/artifacts-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One AI Drama job artifact: from this disk, or a 302 to a signed bucket URL (lib/reel-ai-drama/artifacts-route.ts). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return dramaArtifactResponse(request, id);
}
