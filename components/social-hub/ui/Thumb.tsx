import { TYPE_ICON, typeStyle } from '@/components/social-hub/ui/marks';
import type { HubMedia, HubPost } from '@/lib/social-hub/types';

/** The first image a person would recognize the post by (PRODUCT.md: media, not ids). */
export function thumbOf(media: HubMedia): { src: string | null; count: number | null; remote: boolean } {
  switch (media.kind) {
    case 'slides': {
      const first = media.slides[0];
      return { src: first?.src ?? first?.photo ?? null, count: media.slides.length || null, remote: !first?.src && Boolean(first?.photo) };
    }
    case 'frames':
      return { src: media.frames.find((f) => f.src)?.src ?? null, count: media.frames.length || null, remote: false };
    case 'video':
      return { src: media.poster ?? null, count: null, remote: false };
    default:
      return { src: null, count: null, remote: false };
  }
}

export function Thumb({ post, size = 'md' }: { post: Pick<HubPost, 'vertical' | 'media'>; size?: 'md' | 'lg' }) {
  const { src, count, remote } = thumbOf(post.media);
  const Icon = TYPE_ICON[post.vertical];
  return (
    <span className={`sh-thumb${size === 'lg' ? ' sh-thumb--lg' : ''}`} style={typeStyle(post.vertical)} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" {...(remote ? { referrerPolicy: 'no-referrer' as const } : {})} />
      ) : (
        <Icon size={size === 'lg' ? 22 : 18} />
      )}
      {count && count > 1 ? <span className="sh-thumb__count">{count}</span> : null}
    </span>
  );
}
