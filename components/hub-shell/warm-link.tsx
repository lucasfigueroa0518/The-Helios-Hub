'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ComponentProps, type FocusEvent, type MouseEvent } from 'react';
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';

import { isDataWarmablePath } from '@/lib/hub/warm-paths';

/**
 * On sight, a visible link prefetches the loading shell (AUTO). Hover and focus
 * call /api/hub/warm so shared data caches fill without a full RSC render.
 * The click runs one full prefetch, waits for it, then navigates.
 *
 * Calling the full prefetch twice while the shell entry is still in place makes
 * Next fetch the page twice. The link's own hover prefetch stays off for the
 * same reason.
 *
 * The page you opened is seeded as an auto prefetch that is already marked
 * used. Coming back to it is treated as stale, and Next refetches the page
 * and the drawer as two full loads. That seed already holds the render, so
 * marking it full lets the return reuse it.
 */
const WAIT_MS = 10000;
const START_GRACE_MS = 150;
const FRESH_MS = 4 * 60 * 1000;
const HOVER_DWELL_MS = 200;

type RscWatch = { url: string; done: Promise<void> };

const watches: RscWatch[] = [];
const navInflight = new Map<string, Promise<void>>();
const navFreshUntil = new Map<string, number>();
const dataFreshUntil = new Map<string, number>();
let dataWarmInflight: Promise<void> | null = null;

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

type PrefetchEntry = {
  kind: PrefetchKind;
  lastUsedTime: number | null;
  url?: { pathname: string };
};

type HookNode = {
  memoizedState?: unknown;
  next?: HookNode | null;
};

type FiberNode = {
  memoizedState?: HookNode | null;
  return?: FiberNode | null;
};

function routerCache(state: unknown): Map<string, PrefetchEntry> | null {
  if (!state || typeof state !== 'object') return null;
  const record = state as { prefetchCache?: unknown; value?: unknown };
  if (record.prefetchCache instanceof Map) return record.prefetchCache;
  if (!record.value || typeof record.value !== 'object') return null;
  const resolved = record.value as { prefetchCache?: unknown };
  return resolved.prefetchCache instanceof Map ? resolved.prefetchCache : null;
}

function findPrefetchCache(node: Element): Map<string, PrefetchEntry> | null {
  const fiberKey = Object.keys(node).find((key) => key.startsWith('__reactFiber$'));
  if (!fiberKey) return null;
  let fiber = (node as unknown as Record<string, FiberNode | undefined>)[fiberKey] ?? null;
  const seen = new Set<FiberNode>();
  for (let hop = 0; fiber && hop < 80 && !seen.has(fiber); hop += 1) {
    seen.add(fiber);
    let hook = fiber.memoizedState ?? null;
    for (let index = 0; hook && index < 30; index += 1) {
      const cache = routerCache(hook.memoizedState);
      if (cache) return cache;
      hook = hook.next ?? null;
    }
    fiber = fiber.return ?? null;
  }
  return null;
}

/**
 * The document seed is the auto entry Next already marked used. A shell prefetch
 * has no lastUsedTime, so this leaves it alone and the hover can still load it.
 * Returns true when the click can navigate from that seed.
 */
function reuseDocumentSeed(node: Element | null, pathname: string): boolean {
  if (!node) return false;
  const cache = findPrefetchCache(node);
  if (!cache) return false;
  let reuse = false;
  for (const entry of cache.values()) {
    if (entry?.url?.pathname !== pathname || entry.lastUsedTime == null) continue;
    if (entry.kind === PrefetchKind.AUTO) entry.kind = PrefetchKind.FULL;
    if (entry.kind === PrefetchKind.FULL) reuse = true;
  }
  return reuse;
}

/** One data warm at a time so a menu sweep does not fan out DB reads. */
function warmData(pathname: string): Promise<void> {
  if (!isDataWarmablePath(pathname)) return Promise.resolve();
  const until = dataFreshUntil.get(pathname);
  if (until != null && until > Date.now()) return Promise.resolve();
  if (dataWarmInflight) return dataWarmInflight;
  const url = `/api/hub/warm?path=${encodeURIComponent(pathname)}`;
  dataWarmInflight = fetch(url, { credentials: 'include', cache: 'no-store' })
    .then((res) => {
      if (res.ok || res.status === 204) {
        dataFreshUntil.set(pathname, Date.now() + FRESH_MS);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      dataWarmInflight = null;
    });
  return dataWarmInflight;
}

function warmNavigation(
  href: string,
  node: Element | null,
  router: { prefetch: (href: string, options: { kind: PrefetchKind }) => void },
): Promise<void> {
  const until = navFreshUntil.get(href);
  if (until != null && until > Date.now()) return Promise.resolve();
  const pending = navInflight.get(href);
  if (pending) return pending;
  const pathname = pathnameOf(href);
  if (reuseDocumentSeed(node, pathname)) {
    navFreshUntil.set(href, Date.now() + FRESH_MS);
    return Promise.resolve();
  }
  ensureFetchWatch();
  const from = watches.length;
  router.prefetch(href, { kind: PrefetchKind.FULL });
  const next = waitForPrefetch(pathname, from).then((found) => {
    if (found) navFreshUntil.set(href, Date.now() + FRESH_MS);
  }).finally(() => {
    navInflight.delete(href);
  });
  navInflight.set(href, next);
  return next;
}

export function WarmLink({ onClick, onMouseEnter, onMouseLeave, onFocus, onBlur, ...props }: ComponentProps<typeof Link>) {
  const router = useRouter();
  const href = typeof props.href === 'string' ? props.href : null;
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const shelled = useRef(false);
  const dwell = useRef<number | null>(null);

  const clearDwell = () => {
    if (dwell.current == null) return;
    window.clearTimeout(dwell.current);
    dwell.current = null;
  };

  const queueDataWarm = (hrefValue: string) => {
    clearDwell();
    dwell.current = window.setTimeout(() => {
      dwell.current = null;
      if (dataWarmInflight) return;
      void warmData(pathnameOf(hrefValue));
    }, HOVER_DWELL_MS);
  };

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!href || !anchor) return;
    if (pathnameOf(href) === window.location.pathname) {
      reuseDocumentSeed(anchor, pathnameOf(href));
    }
    const observer = new IntersectionObserver((entries) => {
      if (shelled.current || !entries.some((entry) => entry.isIntersecting)) return;
      shelled.current = true;
      router.prefetch(href, { kind: PrefetchKind.AUTO });
      observer.disconnect();
    });
    observer.observe(anchor);
    return () => {
      observer.disconnect();
      clearDwell();
    };
  }, [href, router]);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || !href) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    clearDwell();
    const ready = warmNavigation(href, event.currentTarget, router);
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
        if (href) queueDataWarm(href);
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        clearDwell();
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        onFocus?.(event);
        if (href) queueDataWarm(href);
      }}
      onBlur={(event) => {
        onBlur?.(event);
        clearDwell();
      }}
      onClick={handleClick}
    />
  );
}
