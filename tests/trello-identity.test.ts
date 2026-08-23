import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { outreachUserDeleteForbidden, remapUsersByEmail } from '@/lib/trello/identity';

describe('trello identity', () => {
  it('remaps donor users onto outreach.users by email', () => {
    const map = remapUsersByEmail(
      [
        { id: 'donor-1', email: 'Tommy@Heliosgroup.ai' },
        { id: 'donor-2', email: 'lucas@heliosgroup.ai' },
      ],
      {
        'tommy@heliosgroup.ai': 'ou-tommy',
        'lucas@heliosgroup.ai': 'ou-lucas',
      },
    );
    assert.equal(map.get('donor-1'), 'ou-tommy');
    assert.equal(map.get('donor-2'), 'ou-lucas');
  });

  it('does not delete outreach.users from the Trello deleteUser action', () => {
    const source = readFileSync(join(process.cwd(), 'app/trello/actions/users.ts'), 'utf8');
    assert.equal(outreachUserDeleteForbidden(source), false);
    assert.match(source, /DELETE FROM boards\.user_profiles/);
    assert.match(source, /Never deletes outreach\.users/);
  });
});
