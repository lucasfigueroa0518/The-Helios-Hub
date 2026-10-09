import { Breadcrumbs } from '@/components/social-hub/nav/Breadcrumbs';
import { DataNotes } from '@/components/social-hub/DataNotes';
import { PostDrawer } from '@/components/social-hub/post/PostDrawer';
import { PostView } from '@/components/social-hub/post/PostView';
import { findPost, type HubDataset } from '@/lib/social-hub/dataset';
import { parseHubId } from '@/lib/social-hub/ids';
import { displayName } from '@/lib/social-hub/views/format';
import { postCrumbs, safeFrom } from '@/lib/social-hub/views/nav';
import { offerer } from '@/lib/social-hub/views/offer';

function lookup(dataset: HubDataset, rawId: string) {
  const id = decodeURIComponent(rawId);
  return parseHubId(id) ? findPost(dataset, id) : null;
}

/** /social/post/[id] on a direct visit or refresh: the same view as the drawer, as a page, with the trail back to where it came from. */
export function PostScreen({ dataset, base, id, from, now }: { dataset: HubDataset; base: string; id: string; from: string | undefined; now: Date }) {
  const post = lookup(dataset, id);
  const origin = safeFrom(base, from);
  return (
    <>
      <Breadcrumbs crumbs={postCrumbs(base, origin, post ? displayName(post) : 'Post')} />
      <DataNotes dataset={dataset} />
      {post ? (
        <div className="sh-panel sh-post-page"><PostView post={post} o={offerer(dataset, now)} dataset={dataset} /></div>
      ) : (
        <div className="sh-panel sh-empty">
          <strong>This post isn’t in the hub any more</strong>
          It may have been removed from its pipeline, or the link is wrong.
        </div>
      )}
    </>
  );
}

/** The same post over the list it was opened from (intercepted route). */
export function PostDrawerScreen({ dataset, base, id, from, now }: { dataset: HubDataset; base: string; id: string; from: string | undefined; now: Date }) {
  const post = lookup(dataset, id);
  const origin = safeFrom(base, from);
  const name = post ? displayName(post) : 'Post';
  const fullHref = `${base}/post/${encodeURIComponent(decodeURIComponent(id))}${origin ? `?from=${encodeURIComponent(origin)}` : ''}`;
  return (
    <PostDrawer title={name} fullHref={fullHref} crumbs={<Breadcrumbs crumbs={postCrumbs(base, origin, name)} />}>
      {post ? (
        <PostView post={post} o={offerer(dataset, now)} dataset={dataset} />
      ) : (
        <div className="sh-empty"><strong>This post isn’t in the hub any more</strong>It may have been removed from its pipeline.</div>
      )}
    </PostDrawer>
  );
}
