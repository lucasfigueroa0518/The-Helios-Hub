import { requestStoryRender } from '@/lib/real-case/jobs';
import { LabError, realCaseRoute } from '@/lib/real-case/lab';
import { loadRealCaseSettings } from '@/lib/real-case/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHY: Record<string, string> = {
  not_found: 'That story is gone.',
  not_makeable: 'Only a story in the pool can be made.',
  already_running: 'That story is already being made.',
};

/** Lucas's Make reel click (RC-10): queues one render for the Real Case worker. The click is the approval. */
export async function POST(request: Request) {
  return realCaseRoute(async ({ db }) => {
    const body = (await request.json().catch(() => null)) as { storyId?: unknown } | null;
    const storyId = typeof body?.storyId === 'string' ? body.storyId.trim() : '';
    if (!UUID.test(storyId)) throw new LabError('Give a story id');
    const result = await requestStoryRender(db, { storyId, trigger: 'click', settings: await loadRealCaseSettings(db) });
    if (!result.ok) throw new LabError(WHY[result.reason] ?? result.reason, 409);
    return result;
  });
}
