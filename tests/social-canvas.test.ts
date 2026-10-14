import assert from 'node:assert/strict';
import test from 'node:test';

import * as SlideCanvasQ from '@/lib/social/jev/questions/slide-canvas.v2';
import type { Post } from '@/lib/social/render/types';

const post: Post = {
  format: 'carousel',
  storyType: 'tech',
  source: 'Helios',
  sourceUrl: 'https://heliosgroup.ai',
  publishedAt: '2026-10-08T12:00:00.000Z',
  issueNumber: 1,
  caption: '',
  slides: [{
    position: 0,
    layoutVariant: 'text',
    textAnchor: 'top',
    icon: 'shield',
    altText: 'A text slide',
    headline: [{ text: 'The lock', role: 'narrative' }],
    body: [{ text: 'Training stays closed.', role: 'narrative' }],
  }],
};

test('a colored canvas sets data-canvas; black stays the default slide', async () => {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SlideTemplate } = await import('@/lib/social/render/SlideTemplate');
  const green = renderToStaticMarkup(React.createElement(SlideTemplate, { post, position: 0, canvas: 'green' }));
  const orange = renderToStaticMarkup(React.createElement(SlideTemplate, { post, position: 0, canvas: 'orange' }));
  const white = renderToStaticMarkup(React.createElement(SlideTemplate, { post, position: 0, canvas: 'white' }));
  const black = renderToStaticMarkup(React.createElement(SlideTemplate, { post, position: 0 }));
  assert.match(green, /data-canvas="green"/);
  assert.match(orange, /data-canvas="orange"/);
  assert.match(white, /data-canvas="white"/);
  assert.doesNotMatch(black, /data-canvas=/);
  const css = (await import('node:fs')).readFileSync('app/social/render/preview/preview.css', 'utf8');
  assert.match(css, /data-canvas="green"/);
  assert.match(css, /data-canvas="orange"/);
  assert.match(css, /data-canvas="white"/);
  assert.match(css, /--brand-canvas:\s*#138510/);
  assert.match(css, /--brand-canvas:\s*#FF5E1A/);
  assert.match(css, /--brand-canvas:\s*#FFFFFF/);
});

test('canvas pick: unused colours stay in play; a colour that leads by more than one drops out; the previous colour is never an option', () => {
  assert.deepEqual(SlideCanvasQ.unusedOf([]), ['black', 'green', 'orange', 'white']);
  assert.deepEqual(SlideCanvasQ.countsOf(['black', 'white', 'black']), { black: 2, green: 0, orange: 0, white: 1 });
  assert.deepEqual(SlideCanvasQ.unusedOf(['black', 'white']), ['green', 'orange']);
  assert.deepEqual(SlideCanvasQ.optionsFor(null, []), ['black', 'green', 'orange', 'white']);
  assert.ok(!SlideCanvasQ.optionsFor('black', ['black']).includes('black'), 'the previous colour is out');
  // black is only one ahead of the unused colours, so it stays in play.
  assert.deepEqual(SlideCanvasQ.optionsFor('white', ['black', 'white']), ['black', 'green', 'orange']);
  // black has pulled two ahead of green/orange: it drops so the unused colours can catch up.
  assert.deepEqual(SlideCanvasQ.optionsFor('white', ['black', 'white', 'black']), ['green', 'orange']);
  assert.equal(SlideCanvasQ.leastUsed(['orange'], 'orange'), 'black');
  const q = SlideCanvasQ.buildQuestions(['green', 'orange']);
  const asked = q[SlideCanvasQ.QUESTION_ID] as { instructions: string; criteria: Record<string, string> };
  assert.deepEqual(Object.keys(asked.criteria), ['green', 'orange']);
  assert.match(asked.instructions, /evenly|unused_canvases|not the default/);
});
