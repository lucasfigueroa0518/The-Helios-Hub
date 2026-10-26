'use client';

import type { CSSProperties } from 'react';

import { AI_EVENTS_FIXTURES } from '@/fixtures/social/ai-events-posts';
import { LOOK_NAMES } from '@/lib/ai-events/looks';
import { SlideTemplate } from '@/lib/social/render/SlideTemplate';

import '../preview.css';
import '@/explainers/design/helios-design-system/premium.css';
import '@/lib/social/render/drafts/index.css';

const SCALE = 0.3;

/**
 * AI Events This Week gallery (plan M5): every sample post (fixtures/social/ai-events-posts.ts), one row
 * per look and copy length, every slide at 30%. One post full size: /social/render/preview?fixture=ae-orb&all=1.
 */
export default function AiEventsGalleryPage() {
  return (
    <div className="preview-shell">
      <div className="preview-shell__meta">AI Events This Week · four looks · max and min copy</div>
      {Object.entries(AI_EVENTS_FIXTURES).map(([id, post]) => {
        const look = post.slides[0]?.aiEvents?.look;
        return (
          <section key={id} className="preview-shell__section" aria-label={id} style={{ width: '100%' }}>
            <h2 className="preview-shell__section-title">
              {look ? LOOK_NAMES[look] : id} · {id.endsWith('-min') ? 'min copy' : 'max copy'} · {post.slides.length} slides
            </h2>
            <p className="preview-shell__section-slug">?fixture={id}&amp;all=1</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
              {post.slides.map((s, i) => (
                <div key={i}>
                  <p className="canvas-gallery__label">{s.layoutVariant}</p>
                  <div
                    className="canvas-gallery__stage"
                    style={{ width: 1080 * SCALE, height: 1350 * SCALE, '--slide-scale': String(SCALE) } as CSSProperties}
                  >
                    <SlideTemplate post={post} position={i} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
