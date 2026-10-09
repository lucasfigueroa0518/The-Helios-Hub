import { createGraph, type InstagramContainerOps } from '@/lib/instagram/graph';

export { metaConfigured, type ContainerStatus, type PublishingLimit } from '@/lib/instagram/graph';

/**
 * Instagram carousel publishing: one image container per slide
 * (`is_carousel_item`), one CAROUSEL parent with the caption, then the shared
 * status poll and `media_publish` (lib/instagram/graph.ts).
 *
 * Everything goes through `CarouselMetaClient` so the publish job runs
 * offline in tests against a stub.
 */
export interface CarouselMetaClient extends InstagramContainerOps {
  createImageItem(imageUrl: string): Promise<string>;
  createCarousel(children: string[], caption: string): Promise<string>;
}

export function createLiveCarouselClient(fetchImpl: typeof fetch = fetch): CarouselMetaClient {
  const { call, igUserId, ops } = createGraph(fetchImpl);
  return {
    ...ops,
    async createImageItem(imageUrl) {
      const body = await call<{ id?: string }>('POST', `/${igUserId}/media`, { image_url: imageUrl, is_carousel_item: 'true' });
      if (!body.id) throw new Error('Meta created no carousel item id.');
      return body.id;
    },
    async createCarousel(children, caption) {
      const body = await call<{ id?: string }>('POST', `/${igUserId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption });
      if (!body.id) throw new Error('Meta created no carousel container id.');
      return body.id;
    },
  };
}
