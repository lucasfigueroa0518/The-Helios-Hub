import { settingsGetRoute, settingsPostRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return settingsGetRoute();
}

/** One setting from the lab ({ key, value }); validated, since these values gate spend. */
export async function POST(request: Request) {
  return settingsPostRoute(request);
}
