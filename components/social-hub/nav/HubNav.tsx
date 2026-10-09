'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useTransition, type ComponentProps, type MouseEvent, type ReactNode } from 'react';

/**
 * Hub navigation without full reloads (REVISIONS G11): every control changes
 * the URL through the router inside one transition, keeps the scroll
 * position, and dims the page while the server renders the new view.
 */

type Go = (href: string, opts?: { history?: 'push' | 'replace'; scroll?: boolean }) => void;

const NavContext = createContext<{ isPending: boolean; go: Go } | null>(null);

export function HubNavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const go = useCallback<Go>((href, opts = {}) => {
    startTransition(() => {
      if (opts.history === 'push') router.push(href, { scroll: opts.scroll ?? false });
      else router.replace(href, { scroll: opts.scroll ?? false });
    });
  }, [router]);
  const value = useMemo(() => ({ isPending, go }), [isPending, go]);
  return (
    <NavContext.Provider value={value}>
      <div className="sh__inner" data-pending={isPending ? '' : undefined} aria-busy={isPending || undefined}>
        {children}
      </div>
    </NavContext.Provider>
  );
}

export function useHubNav(): { isPending: boolean; go: Go } {
  const ctx = useContext(NavContext);
  const router = useRouter();
  return ctx ?? {
    isPending: false,
    go: (href, opts = {}) => (opts.history === 'push' ? router.push(href, { scroll: opts.scroll ?? false }) : router.replace(href, { scroll: opts.scroll ?? false })),
  };
}

/** The current URL's params, and a way to change some of them (null removes; empty values are dropped). */
export function useHubParams() {
  const search = useSearchParams();
  const pathname = usePathname() ?? '';
  const { go, isPending } = useHubNav();
  const hrefWith = useCallback((changes: Record<string, string | null>, path = pathname) => {
    const next = new URLSearchParams(search?.toString() ?? '');
    for (const [key, value] of Object.entries(changes)) {
      if (value == null || value === '') next.delete(key);
      else next.set(key, value);
    }
    const text = next.toString();
    return text ? `${path}?${text}` : path;
  }, [pathname, search]);
  const set = useCallback((changes: Record<string, string | null>, history: 'push' | 'replace' = 'replace') => go(hrefWith(changes), { history }), [go, hrefWith]);
  return { params: search, pathname, hrefWith, set, isPending };
}

function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}

/** A hub link that keeps the scroll position and shows the page as pending; cmd-click still opens a tab. */
export function HubLink({ href, history = 'push', onClick, ...rest }: ComponentProps<typeof Link> & { href: string; history?: 'push' | 'replace' }) {
  const { go } = useHubNav();
  return (
    <Link
      {...rest}
      href={href}
      scroll={false}
      onClick={(event) => {
        onClick?.(event);
        if (!plainClick(event)) return;
        event.preventDefault();
        go(href, { history });
      }}
    />
  );
}
