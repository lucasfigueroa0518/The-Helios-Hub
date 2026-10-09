import type { HubPost, HubSource } from '@/lib/social-hub/types';

/**
 * Dedupe key for a source URL: lower-case host without `www.`, path without a
 * trailing slash, tracking params dropped. Anything unparseable keys as is.
 */
export function sourceKey(url: string): string {
  try {
    const u = new URL(url.trim());
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|oc$)/i.test(key)) u.searchParams.delete(key);
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    const query = u.searchParams.toString();
    return `${host}${path}${query ? `?${query}` : ''}`;
  } catch {
    return url.trim();
  }
}

export function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** All source material across verticals, deduped by URL, with the posts that used it (SH-18). */
export function dedupeSources(posts: readonly HubPost[]): HubSource[] {
  const byKey = new Map<string, HubSource>();
  for (const post of posts) {
    for (const ref of post.sources) {
      const key = sourceKey(ref.url);
      const found = byKey.get(key);
      if (found) {
        if (!found.postIds.includes(post.id)) found.postIds.push(post.id);
        if (!found.verticals.includes(post.vertical)) found.verticals.push(post.vertical);
        if (!found.title && ref.title) found.title = ref.title;
      } else {
        byKey.set(key, { url: ref.url, title: ref.title, postIds: [post.id], verticals: [post.vertical] });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.postIds.length - a.postIds.length || (a.title ?? a.url).localeCompare(b.title ?? b.url));
}
