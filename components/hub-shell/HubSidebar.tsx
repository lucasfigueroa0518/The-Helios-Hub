'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import {
  Home,
  Kanban,
  LayoutDashboard,
  LogOut,
  Mail,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react';

import { HUB_NAV, type HubNavItem } from '@/components/hub-shell/nav';

const STORAGE_KEY = 'helios-hub-sidebar-collapsed';

const ICONS: Record<HubNavItem['id'], typeof Home> = {
  home: Home,
  outreach: Mail,
  dashboards: LayoutDashboard,
  trello: Kanban,
};

export function HubSidebar({ email }: { email: string }) {
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ? `?${searchParams.toString()}` : '';
  const [collapsed, setCollapsed] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const initial = email ? email[0].toUpperCase() : 'H';

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // ignore
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <aside className={`hub-sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="hub-sidebar__header">
        <Link href="/" className="hub-sidebar__brand" aria-label="The Helios Hub">
          <div className="hub-sidebar__logo-wrap">
            <Image
              src="/trello/helios-logo-sm.png"
              alt=""
              width={22}
              height={22}
              className="hub-sidebar__logo"
              priority
            />
          </div>
          {!collapsed && (
            <span className="hub-sidebar__brand-copy">
              <span className="hub-sidebar__brand-title">Helios Hub</span>
              <span className="hub-sidebar__brand-sub">Workspace</span>
            </span>
          )}
        </Link>
        <button
          type="button"
          className="hub-sidebar__collapse"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      <nav className="hub-sidebar__nav" aria-label="Helios Hub">
        {!collapsed && <div className="hub-sidebar__nav-section-label">Navigation</div>}
        {HUB_NAV.map((item) => {
          const Icon = ICONS[item.id];
          const active = item.match(pathname);
          const open = Boolean(item.children?.length) && (hoverId === item.id || (active && !collapsed));
          return (
            <div
              key={item.id}
              className={`hub-nav-item${active ? ' is-active' : ''}${open ? ' is-open' : ''}${item.children ? ' has-children' : ''}`}
              onMouseEnter={() => item.children && setHoverId(item.id)}
              onMouseLeave={() => setHoverId((current) => (current === item.id ? null : current))}
            >
              <Link href={item.href} className="hub-nav-item__row">
                <span className="hub-nav-item__icon">
                  <Icon size={16} aria-hidden="true" />
                </span>
                {!collapsed && <span className="hub-nav-item__label">{item.label}</span>}
              </Link>
              {item.children && !collapsed && (
                <div className="hub-nav-item__sub">
                  <div className="hub-nav-item__sub-inner">
                    {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`hub-nav-item__sub-link${child.match(pathname, search) ? ' is-active' : ''}`}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {item.children && collapsed && open && (
                <div className="hub-nav-flyout" role="menu">
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={child.match(pathname, search) ? 'is-active' : undefined}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="hub-sidebar__footer">
        <div className="hub-sidebar__profile-card">
          <div className="hub-sidebar__avatar" aria-hidden="true">
            {initial}
          </div>
          {!collapsed && <span className="hub-sidebar__email" title={email}>{email}</span>}
          <button
            type="button"
            className="hub-sidebar__signout"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void signOut({ callbackUrl: '/' })}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
