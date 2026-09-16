'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CalendarDays,
  ChevronDown,
  Globe,
  Home,
  Kanban,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  PanelLeft,
  PanelLeftClose,
  Share2,
  X,
} from 'lucide-react';

import { HUB_NAV, type HubNavItem } from '@/components/hub-shell/nav';
import { useMobileNav } from '@/components/hub-shell/MobileNavContext';

const STORAGE_KEY = 'helios-hub-sidebar-collapsed';

const ICONS: Record<HubNavItem['id'], typeof Home> = {
  home: Home,
  outreach: Mail,
  events: CalendarDays,
  dashboards: LayoutDashboard,
  trello: Kanban,
  website: Globe,
  social: Share2,
};

export function HubSidebar({ email }: { email: string }) {
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ? `?${searchParams.toString()}` : '';
  const [collapsed, setCollapsed] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [mobileExpandedId, setMobileExpandedId] = useState<string | null>(null);

  const { isOpen, openMobileNav, closeMobileNav } = useMobileNav();

  const initial = email ? email[0].toUpperCase() : 'H';
  const isTrello = pathname.startsWith('/trello');

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!isOpen) setMobileExpandedId(null);
  }, [isOpen]);

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
    <>
      {/* Mobile top header for non-Trello pages */}
      {!isTrello && (
        <header className="hub-mobile-header">
          <button
            type="button"
            className="hub-mobile-burger"
            onClick={openMobileNav}
            aria-label="Open navigation menu"
          >
            <Menu size={20} />
          </button>
          <Link href="/" className="hub-sidebar__brand" aria-label="The Helios Hub">
            <div className="hub-sidebar__logo-wrap">
              <Image
                src="/trello/helios-logo-sm.png"
                alt=""
                width={20}
                height={20}
                className="hub-sidebar__logo"
                priority
              />
            </div>
            <span className="hub-sidebar__brand-title text-sm font-semibold">Helios Hub</span>
          </Link>
          <div className="hub-sidebar__avatar" aria-hidden="true" style={{ width: 28, height: 28, fontSize: 12 }}>
            {initial}
          </div>
        </header>
      )}

      {/* Desktop Sidebar (hidden on mobile via CSS @media) */}
      <aside className={`hub-sidebar${collapsed ? ' is-collapsed' : ''}`}>
        <div className="hub-sidebar__header">
          {!collapsed && (
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
              <span className="hub-sidebar__brand-copy">
                <span className="hub-sidebar__brand-title">Helios Hub</span>
                <span className="hub-sidebar__brand-sub">Workspace</span>
              </span>
            </Link>
          )}
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
            const open = Boolean(item.children?.length) && hoverId === item.id;
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
                  {item.children && !collapsed && (
                    <ChevronDown size={12} className="hub-nav-item__caret" aria-hidden="true" />
                  )}
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

      {/* Mobile Slide-Over Navigation Drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="hub-mobile-drawer-overlay"
              onClick={closeMobileNav}
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              className="hub-mobile-drawer-panel"
            >
              <div className="hub-mobile-drawer__header">
                <Link href="/" onClick={closeMobileNav} className="hub-sidebar__brand" aria-label="The Helios Hub">
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
                  <span className="hub-sidebar__brand-copy">
                    <span className="hub-sidebar__brand-title">Helios Hub</span>
                    <span className="hub-sidebar__brand-sub">Workspace</span>
                  </span>
                </Link>
                <button
                  type="button"
                  className="hub-mobile-drawer__close"
                  onClick={closeMobileNav}
                  aria-label="Close navigation menu"
                >
                  <X size={18} />
                </button>
              </div>

              <nav className="hub-sidebar__nav flex-1" aria-label="Mobile Navigation">
                <div className="hub-sidebar__nav-section-label">Navigation</div>
                {HUB_NAV.map((item) => {
                  const Icon = ICONS[item.id];
                  const active = item.match(pathname);
                  const open = Boolean(item.children?.length) && mobileExpandedId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`hub-nav-item${active ? ' is-active' : ''}${open ? ' is-open' : ''}${item.children ? ' has-children' : ''}`}
                    >
                      <Link
                        href={item.href}
                        className="hub-nav-item__row"
                        aria-expanded={item.children ? open : undefined}
                        onClick={(event) => {
                          if (!item.children) {
                            closeMobileNav();
                            return;
                          }
                          event.preventDefault();
                          setMobileExpandedId((current) => (current === item.id ? null : item.id));
                        }}
                      >
                        <span className="hub-nav-item__icon">
                          <Icon size={18} aria-hidden="true" />
                        </span>
                        <span className="hub-nav-item__label">{item.label}</span>
                        {item.children && (
                          <ChevronDown size={14} className="hub-nav-item__caret" aria-hidden="true" />
                        )}
                      </Link>
                      {item.children && (
                        <div className="hub-nav-item__sub">
                          <div className="hub-nav-item__sub-inner">
                            {item.children.map((child) => (
                              <Link
                                key={child.href}
                                href={child.href}
                                className={`hub-nav-item__sub-link${child.match(pathname, search) ? ' is-active' : ''}`}
                                onClick={closeMobileNav}
                              >
                                {child.label}
                              </Link>
                            ))}
                          </div>
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
                  <span className="hub-sidebar__email" title={email}>{email}</span>
                  <button
                    type="button"
                    className="hub-sidebar__signout"
                    aria-label="Sign out"
                    title="Sign out"
                    onClick={() => void signOut({ callbackUrl: '/' })}
                  >
                    <LogOut size={16} />
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
