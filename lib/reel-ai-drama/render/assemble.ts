import { HYPERFRAMES_ENV } from '@/lib/explainers/render/workspace';
import { jsonOut, spawnRunner, tail, type Runner } from '@/lib/reel-ai-drama/render/runner';

type KitResult = { ok?: boolean; errors?: string[]; warnings?: string[]; skipped?: string };

/**
 * Assemble the built frames and check them for breakage (MD-39): the kit's assemble (pace if needed,
 * mount, music at the marked frames, sound, captions, index.html, transitions), then try (storyboard,
 * sources, events, determinism), bounds (text and covering) and screen (empty or unloaded pictures, parked
 * off the edge, shown before an entrance, low contrast, text on a busy picture: MD-58). Breakage is returned as problems, never
 * thrown; `warnings` are pacing notes (length, long frames, a long close question).
 */
export async function assembleProject(
  projectDir: string,
  { heygenApiKey = process.env.HEYGEN_API_KEY ?? '', music = true }: { heygenApiKey?: string; music?: boolean } = {},
  deps: { run?: Runner } = {},
): Promise<{ ok: boolean; problems: string[]; warnings: string[] }> {
  const run = deps.run ?? spawnRunner;
  const env = { ...process.env, ...HYPERFRAMES_ENV, HEYGEN_API_KEY: heygenApiKey };
  const problems: string[] = [];
  const warnings: string[] = [];
  const step = (label: string, args: string[], timeoutMs: number) => {
    let res;
    try {
      res = run(process.execPath, args, { cwd: projectDir, env, timeoutMs });
    } catch (e) {
      problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const out = jsonOut<KitResult>(res);
    if (!out) {
      if (res.status !== 0) problems.push(`${label} failed: ${tail(res)}`);
      return;
    }
    problems.push(...(out.errors ?? []).map((e) => `${label}: ${e}`));
    warnings.push(...(out.warnings ?? []));
    if (out.skipped) warnings.push(`${label} skipped: ${out.skipped}`);
    if (res.status !== 0 && !(out.errors ?? []).length) problems.push(`${label} failed: ${tail(res)}`);
  };
  step('assemble', ['assets/kit/assemble.mjs', ...(music ? [] : ['--no-music'])], 10 * 60 * 1000);
  step('try', ['assets/kit/try.mjs'], 5 * 60 * 1000);
  step('bounds', ['assets/kit/bounds.mjs', 'all'], 5 * 60 * 1000);
  step('screen', ['assets/kit/screen.mjs', 'all'], 10 * 60 * 1000);
  return { ok: problems.length === 0, problems, warnings };
}
