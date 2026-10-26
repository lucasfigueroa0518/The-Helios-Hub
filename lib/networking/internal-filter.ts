import type { ListEventsFilter } from '@/lib/networking/repository';
import { INTERNAL_METROS, isInternalMetro, type AccessType, type Bucket, type Metro } from '@/lib/networking/types';

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The internal /events calendar is Boston and Miami only (AE-02): NYC and SF rows feed the
 * public surfaces. Every list and count behind /api/networking/events uses this filter, so
 * `metros` is always INTERNAL_METROS or one of them, whatever the query string says.
 */
export function internalEventsFilter(searchParams: URLSearchParams): ListEventsFilter & { metros: readonly Metro[] } {
  const metro = searchParams.get('metro');
  const bucket = searchParams.get('bucket');
  const access = searchParams.get('access');
  return {
    metros: isInternalMetro(metro) ? [metro] : INTERNAL_METROS,
    bucket: bucket === 'tech' || bucket === 'vertical' || bucket === 'both' ? (bucket as Bucket) : undefined,
    industry: searchParams.get('industry') || undefined,
    access: access === 'open' || access === 'paid' || access === 'invite_only' ? (access as AccessType) : undefined,
    from: parseDate(searchParams.get('from')),
    to: parseDate(searchParams.get('to')),
  };
}
