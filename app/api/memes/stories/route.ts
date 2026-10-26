import { listStories } from '@/lib/memes/api';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Last Few Days stories for the lab picker. Read only against lfd.* / candidate lanes. */
export async function GET() {
  const { liveStorySource } = await import('@/lib/memes/live');
  return memesRoute(({ db }) => listStories(db, liveStorySource));
}
