export type LogLevel = 'info' | 'warn' | 'error';

export type HeliosLogEvent = {
  ts?: string;
  level?: LogLevel;
  component: string;
  event: string;
  /** Vercel request id when present. */
  requestId?: string;
  /** Correlation id from x-helios-trace. */
  traceId?: string;
  [key: string]: unknown;
};

function write(level: LogLevel, payload: HeliosLogEvent): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...payload,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function logInfo(event: HeliosLogEvent): void {
  write('info', event);
}

export function logWarn(event: HeliosLogEvent): void {
  write('warn', event);
}

export function logError(event: HeliosLogEvent): void {
  write('error', event);
}

/** Strip query strings and collapse ids for log cardinality. */
export function logPathname(url: string): string {
  const path = url.split('?')[0] ?? url;
  return path
    .replace(/\/post\/[^/]+/g, '/post/:id')
    .replace(/\/projects\/[^/]+/g, '/projects/:id')
    .replace(/\/night\/\d{4}-\d{2}-\d{2}/g, '/night/:date')
    .replace(/\/pools\/[^/]+/g, '/pools/:type');
}

export function flightKind(headers: {
  rsc?: string;
  prefetch?: string;
  segmentPrefetch?: string;
  accept?: string;
}): 'document' | 'rsc_full' | 'rsc_prefetch' | 'rsc_segment_prefetch' | 'other' {
  if (headers.prefetch) return 'rsc_prefetch';
  if (headers.segmentPrefetch) return 'rsc_segment_prefetch';
  if (headers.rsc === '1' || (headers.accept?.includes('text/x-component') ?? false)) return 'rsc_full';
  return 'document';
}
