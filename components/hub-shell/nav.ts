export type HubSubItem = {
  href: string;
  label: string;
  match: (path: string, search: string) => boolean;
};

export type HubNavItem = {
  id: 'home' | 'outreach' | 'reels' | 'stories' | 'explainers' | 'social' | 'events' | 'dashboards' | 'trello' | 'website';
  href: string;
  label: string;
  badge?: string;
  match: (path: string) => boolean;
  children?: HubSubItem[];
  /** Load the full page when the hub is idle so the click shows it at once (WarmLink `eager`). */
  eager?: boolean;
};

export const HUB_NAV: HubNavItem[] = [
  {
    id: 'home',
    href: '/',
    label: 'Home',
    match: (path) => path === '/',
  },
  {
    id: 'outreach',
    href: '/hub',
    label: 'Outreach Hub',
    match: (path) => path.startsWith('/hub') || path.startsWith('/campaigns'),
  },
  {
    id: 'social',
    href: '/social',
    label: 'Social Hub',
    badge: 'Beta',
    // Its Content page must land in under 100 ms from the click (2026-11-18).
    eager: true,
    match: (path) =>
      path === '/social' ||
      (path.startsWith('/social/') && !path.startsWith('/social/render')) ||
      path.startsWith('/carousels') ||
      path.startsWith('/reels') ||
      path.startsWith('/stories') ||
      path.startsWith('/morning-download') ||
      path.startsWith('/ai-trivia') ||
      path.startsWith('/real-or-ai') ||
      path.startsWith('/explainers') ||
      path.startsWith('/last-few-days') ||
      path.startsWith('/ai-events') ||
      path.startsWith('/field-notes') ||
      path.startsWith('/reel-ai-drama'),
  },
  {
    id: 'dashboards',
    href: '/dashboards',
    label: 'Client Dashboards',
    match: (path) => path.startsWith('/dashboards') && !path.startsWith('/dashboards/d/'),
  },
  {
    id: 'trello',
    href: '/trello',
    label: 'Trello',
    match: (path) => path.startsWith('/trello'),
  },
  {
    id: 'events',
    href: '/events',
    label: 'Networking',
    match: (path) => path.startsWith('/events'),
  },
  {
    id: 'website',
    href: '/seo',
    label: 'Website Hub',
    match: (path) => path.startsWith('/seo') || path.startsWith('/traffic') || path.startsWith('/resource-tracker'),
    children: [
      {
        href: '/seo',
        label: 'SEO Performance',
        match: (path) => path.startsWith('/seo'),
      },
      {
        href: '/traffic',
        label: 'Traffic',
        match: (path) => path.startsWith('/traffic'),
      },
      {
        href: '/resource-tracker',
        label: 'Resource Tracker',
        match: (path) => path.startsWith('/resource-tracker'),
      },
    ],
  },
];
