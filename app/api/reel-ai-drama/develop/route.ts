import { developRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A session searches several cells with web search; give it room. */
export const maxDuration = 800;

/** Lucas's Develop click: one live development session (about $1–3, under the weekly cap). The click is the approval. */
export async function POST(request: Request) {
  return developRoute(request);
}
