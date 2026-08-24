export type HubSubItem = {
  href: string;
  label: string;
  match: (path: string, search: string) => boolean;
};

export type HubNavItem = {
  id: 'home' | 'outreach' | 'events' | 'dashboards' | 'trello';
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
    children: [
      {
        href: '/trello',
        label: 'My boards',
        match: (path, search) => {
          if (!path.startsWith('/trello')) return false;
          const params = new URLSearchParams(search);
          return !params.get('view') && !params.get('board');
        },
      },
      {
        href: '/trello?view=week',
        label: 'Due this week',
        match: (path, search) => path.startsWith('/trello') && new URLSearchParams(search).get('view') === 'week',
      },
      {
        href: '/trello?view=activity',
        label: 'Activity',
        match: (path, search) => path.startsWith('/trello') && new URLSearchParams(search).get('view') === 'activity',
      },
      {
        href: '/trello?view=archive',
        label: 'Archived',
        match: (path, search) => path.startsWith('/trello') && new URLSearchParams(search).get('view') === 'archive',
      },
    ],
  },
  {
    id: 'events',
    href: '/events',
    label: 'Networking',
    match: (path) => path.startsWith('/events'),
  },
];
