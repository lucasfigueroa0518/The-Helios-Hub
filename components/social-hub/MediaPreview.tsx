import type { HubMedia } from '@/lib/social-hub/types';

/**
 * Media preview (spec §6.1): video for reels, swipeable slides for
 * carousels, frames for Stories. Read-only: sources are the pipelines'
 * existing session routes; carousels show the slide outline (OUT_OF_SCOPE #3).
 */
export function MediaPreview({ media, title }: { media: HubMedia; title: string }) {
  if (media.kind === 'video') {
    return media.src ? (
      <video className="sh-media__video" controls playsInline preload="none" src={media.src} aria-label={`${title}, video`} />
    ) : (
      <div className="sh-media__empty">Video not available here. Open it from the content type&apos;s own page.</div>
    );
  }
  if (media.kind === 'frames') {
    if (media.frames.length === 0) return <div className="sh-media__empty">No frames rendered yet.</div>;
    return (
      <ol className="sh-media__strip sh-media__strip--frames" aria-label={`${title}, ${media.frames.length} frames`}>
        {media.frames.map((frame) => (
          <li key={frame.label} className="sh-media__frame">
            {frame.src ? <img src={frame.src} alt={frame.label} loading="lazy" /> : <span className="sh-media__ph">{frame.label}</span>}
            <span className="sh-media__cap">{frame.label}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (media.kind === 'slides') {
    if (media.slides.length === 0) return <div className="sh-media__empty">No slides stored for this post.</div>;
    return (
      <div>
        <ol className="sh-media__strip sh-media__strip--slides" aria-label={`${title}, ${media.slides.length} slides`}>
          {media.slides.map((slide, i) => (
            <li key={i} className={`sh-slide${slide.photo ? ' sh-slide--photo' : ''}`}>
              {slide.src ? (
                <img src={slide.src} alt={slide.alt} loading="lazy" />
              ) : (
                <>
                  {slide.photo ? <img className="sh-slide__photo" src={slide.photo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                  <span className="sh-slide__n">{i + 1}{slide.layout ? ` · ${slide.layout.replace(/_/g, ' ')}` : ''}</span>
                  {slide.headline ? <span className="sh-slide__head">{slide.headline}</span> : null}
                  {slide.body ? <span className="sh-slide__body">{slide.body}</span> : null}
                </>
              )}
            </li>
          ))}
        </ol>
        {media.slides.some((s) => !s.src) ? (
          <p className="sh-subtle">Slide outline from the stored post. The rendered slide images arrive with Phase 2.</p>
        ) : null}
      </div>
    );
  }
  return <div className="sh-media__empty">{media.note}</div>;
}
