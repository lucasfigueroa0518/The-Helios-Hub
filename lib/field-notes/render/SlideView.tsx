/**
 * The Field Notes slide as HTML at 1080x1350 (CONTRACT-v4 section 6): the prepared photo full bleed with
 * the gentle darkening already baked in (layout.ts, darken.ts), the text blocks placed by the layout and
 * set left-aligned in white with a faint shadow, `hand` blocks as inline SVG pen strokes (Hershey Sans,
 * handwrite.ts). No logo (dropped from Follow, 2026-11-06). No marks, arrows, underlines or boxes.
 * Type: Pragmatica Extended Bold (headline), Roboto 400 (body). A backticked span left in body text is set
 * in the system monospace face (backticks not drawn), so code never reads as prose. Fonts and images are
 * inlined, so a render needs no network.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { handSvg } from './handwrite';
import { TEXT_SHADOW, type PlacedBlock, type SlideLayout } from './layout';
import { CODE_SCALE } from './metrics';
import { CANVAS_H, CANVAS_W } from './photo';

/** The full Helios logo (circle with wordmark), the same file the Hub already serves. */
export const LOGO_FILE = 'public/social/helios-mark.png';
export const HEADING_FONT_FILE = 'app/fonts/PragmaticaExtended-Bold.otf';
export const BODY_FONT_FILE = 'lib/field-notes/render/assets/fonts/Roboto-400.woff2';

let assetCache: { css: string; logo: string } | null = null;

async function assets(): Promise<{ css: string; logo: string }> {
  if (assetCache) return assetCache;
  const root = process.cwd();
  const [bold, body, logo] = await Promise.all([
    fsp.readFile(path.join(root, HEADING_FONT_FILE)),
    fsp.readFile(path.join(root, BODY_FONT_FILE)),
    fsp.readFile(path.join(root, LOGO_FILE)),
  ]);
  const css = `
@font-face { font-family: 'Pragmatica Extended'; src: url(data:font/otf;base64,${bold.toString('base64')}) format('opentype'); font-weight: 700; font-style: normal; }
@font-face { font-family: 'Roboto'; src: url(data:font/woff2;base64,${body.toString('base64')}) format('woff2'); font-weight: 400; font-style: normal; }`;
  assetCache = { css, logo: `data:image/png;base64,${logo.toString('base64')}` };
  return assetCache;
}

const PAGE_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${CANVAS_W}px; height: ${CANVAS_H}px; background: #171717; overflow: hidden; }
.fn-slide { position: relative; width: ${CANVAS_W}px; height: ${CANVAS_H}px; overflow: hidden; font-synthesis: none; -webkit-font-smoothing: antialiased; }
.fn-photo { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.fn-logo { position: absolute; display: block; }
.fn-block { position: absolute; text-align: left; }
.fn-text { overflow-wrap: normal; word-break: normal; hyphens: none; white-space: normal; text-shadow: ${TEXT_SHADOW}; }
.fn-heading { font-family: 'Pragmatica Extended', 'Helvetica Neue', Arial, sans-serif; font-weight: 700; text-wrap: balance; }
.fn-body { font-family: 'Roboto', 'Helvetica Neue', Arial, sans-serif; font-weight: 400; text-wrap: pretty; }
.fn-code { font-family: Menlo, 'DejaVu Sans Mono', Consolas, 'Liberation Mono', monospace; font-size: ${CODE_SCALE}em; letter-spacing: 0; }
.fn-handsvg { filter: drop-shadow(0 1px 2px rgba(0,0,0,0.32)); }
.hide-ink .fn-ink { visibility: hidden; }
`;

/** Body text with each backticked span as monospace code (the backticks are not drawn). Other text is plain. */
export function withCode(text: string): React.ReactNode {
  if (!text.includes('`')) return text;
  return text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i} className="fn-code">{part}</code> : part));
}

function BlockView({ b }: { b: PlacedBlock }) {
  if (b.family === 'hand') {
    // The SVG is placed in canvas px so the pen lines land exactly on the block's ink box.
    return <div className="fn-ink" data-block={b.index} data-role={b.role} dangerouslySetInnerHTML={{ __html: handSvg(b.text, b.fontPx, b.region, b.color, String(b.index)) }} />;
  }
  return (
    <div className="fn-block" data-block={b.index} data-role={b.role} style={{ left: b.region.x, top: b.region.y, width: b.region.w }}>
      <div
        className={`fn-text fn-ink ${b.family === 'heading' ? 'fn-heading' : 'fn-body'}`}
        style={{ fontSize: b.fontPx, lineHeight: b.lineHeight, letterSpacing: `${b.trackingEm}em`, color: b.color }}
      >
        {b.family === 'body' ? withCode(b.text) : b.text}
      </div>
    </div>
  );
}

export function SlideView({ layout, logoSrc }: { layout: SlideLayout; logoSrc: string }) {
  return (
    <div className="fn-slide" data-kind={layout.kind}>
      <img className="fn-photo" alt="" src={`data:image/jpeg;base64,${layout.photo.jpeg.toString('base64')}`} />
      {layout.logo && <img className="fn-logo" alt="" data-logo="1" src={logoSrc} style={{ left: layout.logo.rect.x, top: layout.logo.rect.y, width: layout.logo.rect.w, height: layout.logo.rect.h }} />}
      {layout.blocks.map((b) => <BlockView key={`b${b.index}`} b={b} />)}
    </div>
  );
}

/** A full HTML document for one slide. `hideInk` hides the text, leaving the (darkened) photo for the rendered-pixel check. */
export async function buildSlideHtml(layout: SlideLayout, opts: { hideInk?: boolean } = {}): Promise<string> {
  const a = await assets();
  const body = renderToStaticMarkup(<SlideView layout={layout} logoSrc={a.logo} />);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${a.css}${PAGE_CSS}</style></head><body class="${opts.hideInk ? 'hide-ink' : ''}">${body}</body></html>`;
}
