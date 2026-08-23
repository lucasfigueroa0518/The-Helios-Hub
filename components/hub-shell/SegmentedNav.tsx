'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export type SegmentedTab = {
  id: string;
  label: string;
  href: string;
};

type Props = {
  tabs: readonly SegmentedTab[];
  activeId: string;
  ariaLabel: string;
  onPrefetch?: (tab: SegmentedTab) => void;
};

export function SegmentedNav({ tabs, activeId, ariaLabel, onPrefetch }: Props) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const [currentId, setCurrentId] = useState(activeId);
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState({ left: 0, width: 0, ready: false });

  useEffect(() => {
    setCurrentId(activeId);
  }, [activeId]);

  useEffect(() => {
    for (const tab of tabs) router.prefetch(tab.href);
  }, [router, tabs]);

  const measure = useCallback(() => {
    const track = trackRef.current;
    const index = tabs.findIndex((tab) => tab.id === currentId);
    const item = itemRefs.current[index];
    if (!track || !item) return;
    const trackRect = track.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    setThumb({
      left: itemRect.left - trackRect.left,
      width: itemRect.width,
      ready: true,
    });
  }, [currentId, tabs]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(track);
    for (const item of itemRefs.current) {
      if (item) observer.observe(item);
    }
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  function goTo(tab: SegmentedTab) {
    if (tab.id === currentId && tab.href === pathname) return;
    setCurrentId(tab.id);
    router.push(tab.href);
  }

  return (
    <div ref={trackRef} className="segmented hub-nav" role="tablist" aria-label={ariaLabel}>
      <span
        className={`hub-nav__thumb${thumb.ready ? ' hub-nav__thumb--ready' : ''}`}
        aria-hidden="true"
        style={{
          width: thumb.width,
          transform: `translateX(${thumb.left}px)`,
        }}
      />
      {tabs.map((tab, index) => {
        const selected = tab.id === currentId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`hub-nav__item${selected ? ' hub-nav__item--active' : ''}`}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            onMouseEnter={() => onPrefetch?.(tab)}
            onFocus={() => onPrefetch?.(tab)}
            onClick={() => goTo(tab)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
