import { labResults } from '@/lib/memes/api';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return memesRoute(({ db }) => labResults(db));
}
