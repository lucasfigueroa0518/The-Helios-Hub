'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { hubBaseOf } from '@/lib/social-hub/links';

/**
 * Opens a post over the list you're on (REVISIONS G10). The URL is the post's
 * stable content id (D46) plus `from`, so the drawer, the full page and Back
 * all know where you came from.
 */
export function postHrefFrom(path: string, search: string, id: string): string {
  const base = hubBaseOf(path);
  const from = `${path}${search ? `?${search}` : ''}`;
  return `${base}/post/${encodeURIComponent(id)}?from=${encodeURIComponent(from)}`;
}

/**
 * `decorative`: a second link to the same post (a thumbnail beside its name) stays clickable but out of the tab order and the accessibility tree.
 *
 * Prefetched on intent (hover or focus), not on sight: every post page reads
 * the whole hub dataset, and a list prefetched each visible card twice (name
 * and thumbnail), a dozen full server renders per visit that crowded out the
 * page you actually opened.
 */
export function PostLink({ id, className, children, label, decorative = false }: { id: string; className?: string; children: ReactNode; label?: string; decorative?: boolean }) {
  const path = usePathname() ?? '/social';
  const search = useSearchParams()?.toString() ?? '';
  const router = useRouter();
  const href = postHrefFrom(path, search, id);
  const prefetch = () => router.prefetch(href);
  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      scroll={false}
      className={className}
      aria-label={decorative ? undefined : label}
      tabIndex={decorative ? -1 : undefined}
      aria-hidden={decorative || undefined}
      onClick={(e) => {
        // The drawer opens after the route loads; remember the row so focus can return to it on close.
        (window as Window & { __shOpener?: HTMLElement }).__shOpener = e.currentTarget;
      }}
    >
      {children}
    </Link>
  );
}
