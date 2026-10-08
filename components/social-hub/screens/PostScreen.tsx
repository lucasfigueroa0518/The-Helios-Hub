import Link from 'next/link';

import { DataNotes } from '@/components/social-hub/DataNotes';
import { PostView } from '@/components/social-hub/PostView';
import { findPost, type HubDataset } from '@/lib/social-hub/dataset';
import { parseHubId } from '@/lib/social-hub/ids';

/** /social/post/[id]: the same post view as the drawer, as a page (deep link, phone). */
export function PostScreen({ dataset, base, id }: { dataset: HubDataset; base: string; id: string }) {
  const parsed = parseHubId(id);
  const post = parsed ? findPost(dataset, decodeURIComponent(id)) : null;
  return (
    <>
      <p><Link href={base} className="sh-link">‹ Social Hub</Link></p>
      <DataNotes dataset={dataset} />
      {post ? (
        <div className="sh-card sh-card__body"><PostView post={post} /></div>
      ) : (
        <div className="sh-card sh-empty">
          <strong>{parsed ? 'Post not found' : 'Not a hub post id'}</strong>
          It may have been removed from its pipeline, or the link is wrong.
        </div>
      )}
    </>
  );
}
