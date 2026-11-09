import { settingsGetRoute, settingsPostRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return settingsGetRoute();
}

/** `{ values: { key: value } }` (or the legacy `{ key, value }`); validated together, all or nothing. */
export async function POST(request: Request) {
  return settingsPostRoute(request);
}
