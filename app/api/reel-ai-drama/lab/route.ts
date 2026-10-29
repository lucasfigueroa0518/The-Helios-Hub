import { labRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything the Reel AI Drama lab shows. Reads only; spends nothing. */
export async function GET() {
  return labRoute();
}
