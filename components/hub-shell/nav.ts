export type HubSubItem = {
  href: string;
  label: string;
  match: (path: string, search: string) => boolean;
};

export type HubNavItem = {
  id: 'home' | 'outreach' | 'events' | 'dashboards' | 'trello' | 'website' | 'social';
  href: string;
  label: string;
  match: (path: string) => boolean;
  children?: HubSubItem[];
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
    id: 'social',
    href: '/social',
    label: 'Social',
    match: (path) => path.startsWith('/social'),
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
    match: (path) => path.startsWith('/seo') || path.startsWith('/traffic'),
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
    ],
  },
];
