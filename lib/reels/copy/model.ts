import { COPY_MODEL } from '@/lib/reels/config';

/**
 * A Sonnet release id: claude-sonnet-5, claude-sonnet-5-5. Dated snapshots
 * and other suffixes are not releases. The highest major, then minor, is
 * the latest Sonnet (D-222). Anthropic does not move an existing id forward,
 * so the models list is what keeps the copy writer on the current one.
 */
const SONNET_RELEASE = /^claude-sonnet-(\d+)(?:-(\d+))?$/;

export function latestSonnetModelId(ids: readonly string[]): string | null {
  let best: { id: string; major: number; minor: number } | null = null;
  for (const id of ids) {
    const match = SONNET_RELEASE.exec(id);
    if (!match) continue;
    const major = Number(match[1]);
    const minor = match[2] ? Number(match[2]) : 0;
    if (!best || major > best.major || (major === best.major && minor > best.minor)) {
      best = { id, major, minor };
    }
  }
  return best?.id ?? null;
}

type ModelList = AsyncIterable<{ id: string }> | Iterable<{ id: string }>;

/** The latest Sonnet on the account, or COPY_MODEL when the list cannot be read. */
export async function resolveCopyModel(list: () => Promise<ModelList> | ModelList): Promise<string> {
  try {
    const ids: string[] = [];
    for await (const model of await list()) ids.push(model.id);
    return latestSonnetModelId(ids) ?? COPY_MODEL;
  } catch {
    return COPY_MODEL;
  }
}
