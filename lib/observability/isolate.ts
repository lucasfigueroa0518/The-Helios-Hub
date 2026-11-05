import { logInfo } from '@/lib/observability/log-event';

const KEY = '__heliosIsolateSeen';

/** First work in this Vercel isolate (cold start). */
export function markIsolateBoot(component: string, detail: Record<string, unknown> = {}): void {
  const g = globalThis as typeof globalThis & { [KEY]?: boolean };
  if (g[KEY]) return;
  g[KEY] = true;
  logInfo({
    component,
    event: 'isolate_cold_start',
    region: process.env.VERCEL_REGION ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    ...detail,
  });
}

export function isolateAlreadyWarm(): boolean {
  const g = globalThis as typeof globalThis & { [KEY]?: boolean };
  return g[KEY] === true;
}
