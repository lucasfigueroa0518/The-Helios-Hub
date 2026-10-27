import { ServerResponse, type IncomingMessage } from 'node:http';

import { flightKind, logInfo, logPathname } from '@/lib/observability/log-event';
import {
  HELIOS_START_HEADER,
  HELIOS_TRACE_HEADER,
} from '@/lib/observability/trace-headers';
import { HUB_TIMING_HEADER } from '@/lib/social-hub/server-timing-path';
import { hubTimingValue } from '@/lib/social-hub/server-timing-store';

const INSTALLED = Symbol.for('helios.requestTelemetry');
const TRACE_HEADER = HELIOS_TRACE_HEADER;
const START_HEADER = HELIOS_START_HEADER;

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function requestMeta(req: IncomingMessage): Record<string, unknown> {
  const url = req.url ?? '';
  const timingId = header(req, HUB_TIMING_HEADER);
  const serverTiming = timingId ? hubTimingValue(timingId) : undefined;
  const startRaw = header(req, START_HEADER);
  const startMs = startRaw ? Number(startRaw) : NaN;
  const durationMs = Number.isFinite(startMs) ? Math.max(0, Date.now() - startMs) : null;
  return {
    traceId: header(req, TRACE_HEADER) ?? null,
    requestId: header(req, 'x-vercel-id') ?? null,
    method: req.method ?? 'GET',
    path: logPathname(url),
    flight: flightKind({
      rsc: header(req, 'rsc'),
      prefetch: header(req, 'next-router-prefetch'),
      segmentPrefetch: header(req, 'next-router-segment-prefetch'),
      accept: header(req, 'accept'),
    }),
    durationMs,
    serverTiming: serverTiming ?? null,
    region: process.env.VERCEL_REGION ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  };
}

/**
 * One structured log per HTTP response (Node runtime). Shows up in Vercel runtime logs.
 * Filter with: component: "http-request" AND path:/social
 */
export function installHttpRequestTelemetry(): void {
  const g = globalThis as typeof globalThis & { [INSTALLED]?: boolean };
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;

  const originalEmit = ServerResponse.prototype.emit;
  ServerResponse.prototype.emit = function emit(this: ServerResponse, event: string, ...args: unknown[]) {
    if (event === 'finish') {
      const req = this.req;
      if (req && header(req, TRACE_HEADER)) {
        logInfo({
          component: 'http-request',
          event: 'response_finish',
          status: this.statusCode,
          ...requestMeta(req),
        });
      }
    }
    return originalEmit.apply(this, [event, ...args] as Parameters<typeof originalEmit>);
  };
}
