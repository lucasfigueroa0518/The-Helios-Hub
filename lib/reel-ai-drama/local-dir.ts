import path from 'node:path';

/**
 * Where this host keeps Reel AI Drama's logs and working files (HUB-WIRING-CONTRACT.md §7.1 item 6):
 * REEL_AI_DRAMA_LOCAL_DIR (default `.explainers-local/reel-ai-drama`), and jobs under REEL_AI_DRAMA_JOBS_DIR
 * (default `<LOCAL_DIR>/jobs`). On a VM: REEL_AI_DRAMA_LOCAL_DIR=/opt/helios-social/reel-ai-drama.
 */
export function dramaLocalDir(env: Record<string, string | undefined> = process.env): string {
  return env.REEL_AI_DRAMA_LOCAL_DIR?.trim() || path.join(process.cwd(), '.explainers-local', 'reel-ai-drama');
}

export function dramaJobsDir(env: Record<string, string | undefined> = process.env): string {
  return env.REEL_AI_DRAMA_JOBS_DIR?.trim() || path.join(dramaLocalDir(env), 'jobs');
}

export const dramaLogDir = (env: Record<string, string | undefined> = process.env): string => path.join(dramaLocalDir(env), 'logs');
