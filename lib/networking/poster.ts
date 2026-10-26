/**
 * Organizer posters for rank slides (AE-33): Luma `event.cover_url`, Meetup's featured
 * photo. Only http(s) URLs are kept. The public snapshot never publishes these.
 */

export function httpImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Luma's event poster. Discover entries and `event/get` both put it on `event.cover_url`. */
export function lumaPosterUrl(event: { cover_url?: unknown } | null | undefined): string | null {
  return httpImageUrl(event?.cover_url);
}

type MeetupPhoto = { highResUrl?: unknown; source?: unknown; baseUrl?: unknown } | null | undefined;

/** Meetup's event photo: the find/group page's `imageUrl`, else the event page's featured photo. */
export function meetupPosterUrl(
  raw: { imageUrl?: unknown; featuredEventPhoto?: MeetupPhoto } | null | undefined,
): string | null {
  const photo = raw?.featuredEventPhoto;
  return (
    httpImageUrl(raw?.imageUrl) ??
    httpImageUrl(photo?.highResUrl) ??
    httpImageUrl(photo?.source) ??
    httpImageUrl(photo?.baseUrl)
  );
}
