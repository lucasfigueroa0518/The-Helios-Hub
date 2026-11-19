'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';

import { postHrefFrom } from '@/components/social-hub/nav/PostLink';

/** Anything inside a card that does its own thing on click. */
const OWN_ACTION = 'a, button, input, select, textarea, label, summary, video, dialog, [role="button"], [role="menu"], [role="menuitem"], [data-card-ignore]';

/**
 * A post card whose whole surface opens the post's sidebar (Lucas, 2026-11-19): a click anywhere that isn't a link,
 * button or other control inside the card opens the post the same way its name link does. The name link stays the
 * keyboard and screen-reader path, so the card itself adds no tab stop.
 */
export function PostCard({ id, className, style, children }: { id: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  const router = useRouter();
  const path = usePathname() ?? '/social';
  const search = useSearchParams()?.toString() ?? '';
  const href = postHrefFrom(path, search, id);

  const onClick = (e: MouseEvent<HTMLLIElement>) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(OWN_ACTION)) return;
    if (window.getSelection()?.toString()) return; // selecting text is not a click to open
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    (window as Window & { __shOpener?: HTMLElement }).__shOpener = e.currentTarget;
    router.push(href, { scroll: false });
  };

  return (
    <li className={`${className ?? ''} sh-card-open`} style={style} onClick={onClick} onMouseEnter={() => router.prefetch(href)}>
      {children}
    </li>
  );
}
