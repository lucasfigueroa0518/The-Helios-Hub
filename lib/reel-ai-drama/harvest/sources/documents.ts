import { siteOf } from '@/lib/reel-ai-drama/reporting/validate';

import type { RawCandidate, Source, SourceName } from '../types';

/**
 * Pages, posts, headlines, documents and arXiv papers, captured by us (screens.ts) with measured boxes
 * for the marks (MD-43). Made by code, so trusted: a site's own branding is the subject, not a watermark
 * (research 04 §4.2). PDFs are skipped until a page renderer is added.
 */

function screenSource(source: Extract<SourceName, 'screen' | 'document' | 'paper'>): Source {
  return async (want, run) => {
    if (!want.url) return [];
    const shoot = run.deps.screenshot;
    if (!shoot) {
      const note = 'screenshots: skipped (no Playwright browser)';
      if (!run.notes.includes(note)) run.notes.push(note);
      return [];
    }
    if (/\.pdf(\?|#|$)/i.test(want.url)) {
      run.notes.push(`${want.url}: PDF not captured (no PDF page renderer yet)`);
      return [];
    }
    const phrases = (want.phrases ?? []).filter((p) => p.trim());
    const shot = await shoot(want.url, { out: run.nextName('png'), phrases });
    const missing = phrases.filter((p) => !shot.boxes.some((b) => b.text === p));
    const host = siteOf(want.url);
    const day = shot.captured_at.slice(0, 10);
    const marked = shot.boxes.length ? `; "${shot.boxes[0].text}" is measured for marks` : '';
    const candidate: RawCandidate = {
      source,
      want: want.id,
      kind: want.kind,
      url: null,
      localFile: shot.file,
      source_page: want.url,
      credit: `Screenshot of ${host}, captured ${day}`,
      license: null,
      caption: shot.title,
      people: [],
      qids: [],
      place: null,
      date_taken: day,
      date_basis: 'capture',
      width: shot.width,
      height: shot.height,
      character_image: false,
      made: true,
      trusted: true,
      shows: `A screenshot of ${source === 'paper' ? 'the arXiv page' : 'the page'} "${shot.title}" on ${host}, captured ${day}${marked}.`,
      text_boxes: shot.boxes,
      flags: missing.map((p) => `phrase_not_found:${p.slice(0, 60)}`),
    };
    return [candidate];
  };
}

export const screenSourceAdapter = screenSource('screen');
export const documentSource = screenSource('document');
export const paperSource = screenSource('paper');
