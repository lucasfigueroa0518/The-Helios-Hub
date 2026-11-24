import { LabError, realCaseRoute } from '@/lib/real-case/lab';
import { isRealCaseSettingKey, saveRealCaseSetting } from '@/lib/real-case/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The lab's settings toggles (auto_scout and the caps). Validated: these values gate spend. */
export async function POST(request: Request) {
  return realCaseRoute(async ({ db }) => {
    const body = (await request.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
    const key = typeof body?.key === 'string' ? body.key : '';
    if (!isRealCaseSettingKey(key)) throw new LabError(`Unknown setting ${key || '(none)'}`);
    try {
      return { key, value: await saveRealCaseSetting(db, key, body?.value) };
    } catch (error) {
      throw new LabError(error instanceof Error ? error.message : String(error));
    }
  });
}
