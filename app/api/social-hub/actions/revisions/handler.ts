import type { ContentActions } from '@/lib/publishing/actions/types';
import { toBoxRow } from '@/lib/revisions/box-state';
import type { ReadSpec } from '@/lib/social-hub/action-route';
import type { Vertical } from '@/lib/social-hub/types';

import { parseTarget, type Parsed } from '../content-action';

/** A ref's name in the query string: the same keys a post's `refs` carry (postId, setId, videoJobId, jobId …). */
const REF_KEY = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

type Read = Parsed & { refresh: boolean };

/**
 * `?vertical=<type>&<refKey>=<uuid>…[&refresh=1]`: every parameter but `vertical` and `refresh` is a
 * ref, checked like the action bodies (parseTarget: a known type, every ref a uuid).
 */
export function parseRevisionsQuery(params: URLSearchParams): Read | null {
  const refs: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key === 'vertical' || key === 'refresh') continue;
    if (!REF_KEY.test(key) || key in refs) return null;
    refs[key] = value;
  }
  const parsed = parseTarget({ vertical: params.get('vertical'), refs });
  return parsed ? { vertical: parsed.vertical, target: parsed.target, refresh: params.get('refresh') === '1' } : null;
}

/**
 * The revision box's poll (Targeted Revisions): a post's revision rows, newest first, with only the
 * fields the box shows (toBoxRow). The post is found through its type's own action layer (the
 * same `itemOf` its revise verb uses). Unreachable (404) while the `revise` flag is off.
 * `refresh=1` (sent once a request ends) drops the type's cached hub read so the revised preview shows.
 */
export function revisionsRead(actions: () => Promise<Record<Vertical, ContentActions>>): ReadSpec<Read> {
  return {
    flag: 'revise',
    parse: parseRevisionsQuery,
    refresh: (b) => (b.refresh ? b.vertical : null),
    run: async ({ vertical, target }) => {
      const read = (await actions())[vertical].revisions;
      if (!read) return { status: 409, body: { ok: false, note: 'Changes aren’t available for this post here.', rows: [] } };
      const rows = await read(target);
      if (!rows) return { status: 404, body: { ok: false, note: 'The post is gone.', rows: [] } };
      return { status: 200, body: { ok: true, rows: rows.map(toBoxRow) } };
    },
  };
}
