import type { ActiveView } from '@/lib/trello/useBoardState';

export function parseTrelloSearch(search: string): { view: ActiveView; boardId?: string } {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const boardId = params.get('board') ?? undefined;
  if (boardId) return { view: 'board', boardId };
  const view = params.get('view');
  if (view === 'week') return { view: 'sv_week' };
  if (view === 'activity') return { view: 'sv_activity' };
  if (view === 'archive') return { view: 'sv_archive' };
  if (view === 'mine') return { view: 'sv_mine' };
  if (view === 'profile') return { view: 'sv_profile' };
  return { view: 'home' };
}

export function trelloHref(view: ActiveView, boardId?: string): string {
  if (view === 'board' && boardId) return `/trello?board=${boardId}`;
  if (view === 'sv_week') return '/trello?view=week';
  if (view === 'sv_activity') return '/trello?view=activity';
  if (view === 'sv_archive') return '/trello?view=archive';
  if (view === 'sv_mine') return '/trello?view=mine';
  if (view === 'sv_profile') return '/trello?view=profile';
  return '/trello';
}
