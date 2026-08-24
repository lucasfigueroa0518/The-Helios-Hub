import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  cardAssociatedWithUser,
  cardMatchesUserFilter,
} from '@/lib/trello/card-filter';
import {
  isSharedHeliosWorkspace,
  matchesUserLookup,
  SHARED_WORKSPACE_NAME,
  usersInWorkspace,
  usersNotInWorkspace,
} from '@/lib/trello/workspace-access';
import type { User, WorkspaceMember } from '@/lib/trello/types';

const lucas: User = {
  id: 'lucas',
  email: 'lucas@heliosgroup.ai',
  firstName: 'Lucas',
  lastName: '',
  name: 'Lucas',
  role: '',
  hue: 1,
};
const tommy: User = {
  id: 'tommy',
  email: 'tommy@heliosgroup.ai',
  firstName: 'Tommy',
  lastName: '',
  name: 'Tommy',
  role: '',
  hue: 2,
};

const members: WorkspaceMember[] = [
  {
    id: 'm1',
    workspaceId: 'helios',
    userId: 'tommy',
    role: 'owner',
    joinedAt: '2026-01-01',
  },
  {
    id: 'm2',
    workspaceId: 'helios',
    userId: 'lucas',
    role: 'member',
    joinedAt: '2026-01-01',
  },
  {
    id: 'm3',
    workspaceId: 'personal',
    userId: 'tommy',
    role: 'owner',
    joinedAt: '2026-01-01',
  },
];

describe('trello workspace access', () => {
  it('names the shared Helios Group workspace', () => {
    assert.equal(SHARED_WORKSPACE_NAME, 'Helios Group');
    assert.equal(isSharedHeliosWorkspace('Helios Group'), true);
    assert.equal(isSharedHeliosWorkspace('helios group'), true);
    assert.equal(isSharedHeliosWorkspace("Tommy's Workspace"), false);
  });

  it('lists every user in a workspace and excludes them from lookup', () => {
    const inHelios = usersInWorkspace([lucas, tommy], members, 'helios');
    assert.deepEqual(inHelios.map((u) => u.id).sort(), ['lucas', 'tommy']);
    const addable = usersNotInWorkspace([lucas, tommy], members, 'personal', 'tommy');
    assert.deepEqual(addable.map((u) => u.id), ['lucas']);
  });

  it('matches user lookup by name or email', () => {
    assert.equal(matchesUserLookup(lucas, 'luc'), true);
    assert.equal(matchesUserLookup(lucas, 'heliosgroup'), true);
    assert.equal(matchesUserLookup(lucas, 'tommy'), false);
  });
});

describe('trello card user filter', () => {
  it('treats created cards as belonging to the creator', () => {
    const card = { assigneeIds: [], createdById: 'lucas' };
    assert.equal(cardAssociatedWithUser(card, 'lucas'), true);
    assert.equal(cardAssociatedWithUser(card, 'tommy'), false);
    assert.equal(cardMatchesUserFilter(card, ['lucas']), true);
    assert.equal(cardMatchesUserFilter(card, ['tommy']), false);
  });

  it('keeps assigned cards even when someone else created them', () => {
    const card = { assigneeIds: ['tommy'], createdById: 'lucas' };
    assert.equal(cardMatchesUserFilter(card, ['tommy']), true);
    assert.equal(cardMatchesUserFilter(card, []), true);
  });
});

describe('trello share and home UI', () => {
  it('shares boards by user lookup, not email + name fields', () => {
    const share = readFileSync(join(process.cwd(), 'app/trello/actions/boardShare.ts'), 'utf8');
    assert.match(share, /userId: string/);
    assert.doesNotMatch(share, /firstName/);
    assert.doesNotMatch(share, /lastName/);
    const menu = readFileSync(join(process.cwd(), 'components/trello/board/BoardMenu.tsx'), 'utf8');
    assert.match(menu, /UserLookup/);
    assert.doesNotMatch(menu, /placeholder="First name"/);
    assert.doesNotMatch(menu, /placeholder="Email"/);
  });

  it('does not mark a current workspace on the Trello home page', () => {
    const home = readFileSync(join(process.cwd(), 'components/trello/views/HomeView.tsx'), 'utf8');
    assert.doesNotMatch(home, /isCurrent/);
    assert.doesNotMatch(home, />Current</);
    assert.doesNotMatch(home, /Switch to /);
  });

  it('auto-joins Helios Group on Trello profile ensure', () => {
    const source = readFileSync(join(process.cwd(), 'lib/trello/ensure-profile.ts'), 'utf8');
    assert.match(source, /ensureSharedWorkspaceMembership/);
    assert.match(source, /SHARED_WORKSPACE_NAME/);
  });
});
