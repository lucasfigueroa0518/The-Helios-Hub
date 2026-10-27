'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ComponentProps, type FocusEvent, type MouseEvent } from 'react';
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';

/**
 * On sight, a visible link prefetches the loading shell. Hover and focus start
 * one full prefetch. The click waits for that response when one is in flight,
 * then navigates, so the click uses it instead of starting another.
 *
 * Calling the full prefetch twice while the shell entry is still in place makes
 * Next fetch the page twice. The link's own hover prefetch stays off for the
 * same reason. A prefetch that does not start a request is already cached, and
 * the click navigates immediately.
 */
const WAIT_MS = 10000;
const START_GRACE_MS = 150;
const FRESH_MS = 4 * 60 * 1000;

type RscWatch = { url: string; done: Promise<void> };

const watches: RscWatch[] = [];
const inflight = new Map<string, Promise<void>>();
const freshUntil = new Map<string, number>();

function pathnameOf(href: string): string {
  return new URL(href, window.location.origin).pathname;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function ensureFetchWatch(): void {
  const marked = window as Window & { __heliosRscWatch?: boolean };
  if (marked.__heliosRscWatch) return;
  marked.__heliosRscWatch = true;
  const orig = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const response = orig(input, init);
    if (url.includes('_rsc=')) {
      const done = response.then(async (res) => {
        try {
          await res.clone().arrayBuffer();
        } catch {
          // The body can already be closed. The click still navigates.
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }, () => undefined);
      watches.push({ url, done });
    }
    return response;
  }) as typeof window.fetch;
}

function matchingWatch(pathname: string, from: number): RscWatch | undefined {
  return watches.slice(from).find((watch) => {
    try {
      const url = new URL(watch.url, window.location.origin);
      return url.origin === window.location.origin && url.pathname === pathname && url.searchParams.has('_rsc');
    } catch {
      return false;
    }
  });
}

function waitForPrefetch(pathname: string, from: number): Promise<boolean> {
  const existing = matchingWatch(pathname, from);
  if (existing) return existing.done.then(() => true);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      const started = matchingWatch(pathname, from);
      if (!started) {
        resolve(false);
        return;
      }
      const cap = window.setTimeout(() => resolve(true), WAIT_MS);
      started.done.then(() => {
        window.clearTimeout(cap);
        resolve(true);
      });
    }, START_GRACE_MS);
    void timer;
  });
}

function warm(href: string, router: { prefetch: (href: string, options: { kind: PrefetchKind }) => void }): Promise<void> {
  const until = freshUntil.get(href);
  if (until != null && until > Date.now()) return Promise.resolve();
  const pending = inflight.get(href);
  if (pending) return pending;
  ensureFetchWatch();
  const pathname = pathnameOf(href);
  const from = watches.length;
  router.prefetch(href, { kind: PrefetchKind.FULL });
  const next = waitForPrefetch(pathname, from).then((found) => {
    if (found) freshUntil.set(href, Date.now() + FRESH_MS);
  }).finally(() => {
    inflight.delete(href);
  });
  inflight.set(href, next);
  return next;
}

export function WarmLink({ onClick, onMouseEnter, onFocus, ...props }: ComponentProps<typeof Link>) {
  const router = useRouter();
  const href = typeof props.href === 'string' ? props.href : null;
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const shelled = useRef(false);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!href || !anchor) return;
    const observer = new IntersectionObserver((entries) => {
      if (shelled.current || !entries.some((entry) => entry.isIntersecting)) return;
      shelled.current = true;
      router.prefetch(href, { kind: PrefetchKind.AUTO });
      observer.disconnect();
    });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [href, router]);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || !href) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    const ready = warm(href, router);
    ready.then(() => {
      router.push(href);
    });
  };

  return (
    <Link
      {...props}
      ref={anchorRef}
      prefetch={false}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        if (href) warm(href, router);
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        onFocus?.(event);
        if (href) warm(href, router);
      }}
      onClick={handleClick}
    />
  );
}
