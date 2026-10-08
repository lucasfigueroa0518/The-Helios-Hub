import type { RefreshState } from '@/lib/social-hub/refresh';
import { dateTimeLabel } from '@/lib/social-hub/time';

/** Freshness line (SH-23): "Refreshing…" while the worker pulls, else when numbers last moved. */
export function RefreshNote({ refresh }: { refresh: RefreshState }) {
  if (!refresh.available) return null;
  return (
    <p className="sh-subtle" role="status" aria-live="polite">
      {refresh.pending
        ? 'Refreshing… the social worker is pulling the latest numbers. Reload in a minute or two.'
        : refresh.lastRefresh
          ? `Numbers last refreshed ${dateTimeLabel(refresh.lastRefresh)} ET.`
          : 'No hub refresh has run yet.'}
    </p>
  );
}
