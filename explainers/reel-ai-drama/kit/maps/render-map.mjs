// A printed-paper map of a place (MD-43: maps look printed, not mostly white), for the `map` treatment.
// MapLibre GL with OpenFreeMap's liberty style, points of interest and transit hidden (keep maps clean,
// research 03 §7), then printed: a warm sepia ink, the kit's paper texture multiplied in, a warm tint,
// grain and a vignette. The network is used here only, at harvest time (B2's places step calls it); a
// frame never loads a map, it shows the PNG this writes.
//
//   renderMap({ lat, lon, zoom, label, sublabel, out }) → writes three files:
//     <out>              the printed map with an orange pin on the place and a Helios label (a still)
//     <stem>.plain.<ext> the same map without pin or label (the `map` treatment drops them in itself)
//     <stem>.map.json    { lat, lon, zoom, label, sublabel, width, height, pin: { x, y }, plain }
//   The place is the centre of the image; pin is in image pixels. Size: 1620×2880 (1080×1920 at 1.5×,
//   so a Ken Burns push stays sharp).
//
//   node explainers/reel-ai-drama/kit/maps/render-map.mjs --lat 40.0 --lon -100.0 --zoom 14 \
//     --label "The restaurant" --sublabel "The town" --out media/V7.png

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(HERE, '..');
const REPO = resolve(KIT, '../../..');
export const VIEW = { w: 1080, h: 1920, scale: 1.5 };
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const MAPLIBRE = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';
/** Layers hidden for a clean, printed map: points of interest, transit, house numbers, one-way arrows. */
export const HIDE = /poi|transit|housenumber|oneway|aerialway|ferry/i;

/** The printed look, as CSS: the map is inked sepia, then paper, tint, grain and vignette over it. */
export const PRINT = {
  map: 'sepia(.7) saturate(1.05) contrast(1.32) brightness(.84) hue-rotate(-6deg)',
  paperOpacity: 0.75,
  tint: '#d9c39a',
  tintOpacity: 0.42,
  grainOpacity: 0.3,
  vignette: 'radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 48%, rgba(60,38,16,.45) 100%)',
};

const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The page that draws the map (pure: tests check it without a browser). */
export function mapPage({ lat, lon, zoom }, textures = null) {
  const tex = textures ?? { paper: '', grain: '' };
  return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;width:${VIEW.w}px;height:${VIEW.h}px;overflow:hidden;background:#e9dfcb}
#map{position:absolute;inset:0;filter:${PRINT.map}}
.l{position:absolute;inset:0;pointer-events:none}
#paper{background:url('${tex.paper}') 0 0/512px 512px;mix-blend-mode:multiply;opacity:${PRINT.paperOpacity}}
#tint{background:${PRINT.tint};mix-blend-mode:multiply;opacity:${PRINT.tintOpacity}}
#grain{inset:-20%;background:url('${tex.grain}') 0 0/512px 512px;mix-blend-mode:multiply;opacity:${PRINT.grainOpacity}}
#vig{background:${PRINT.vignette}}
#marks{position:absolute;inset:0}
</style>
<script src="${MAPLIBRE}"></script></head><body>
<div id="map"></div><div id="tint" class="l"></div><div id="paper" class="l"></div><div id="grain" class="l"></div><div id="vig" class="l"></div><div id="marks"></div>
<script>
window.mapReady = false;
const map = new maplibregl.Map({ container: 'map', style: '${STYLE_URL}', center: [${Number(lon)}, ${Number(lat)}], zoom: ${Number(zoom)},
  interactive: false, attributionControl: false, preserveDrawingBuffer: true, fadeDuration: 0 });
map.on('load', () => {
  for (const layer of map.getStyle().layers) if (${HIDE}.test(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none');
  map.once('idle', () => { window.mapReady = true; });
});
</script></body></html>`;
}

/** The pin and label laid over the map (Helios type, orange pin), as HTML for #marks. */
export function marksHtml({ label, sublabel }, fonts = null) {
  const f = fonts ?? { pragmatica: '', roboto: '' };
  const cx = VIEW.w / 2, cy = VIEW.h / 2;
  const right = `left:${cx + 52}px;top:${cy - 46}px`;
  return `<style>@font-face{font-family:'Pragmatica Extended';src:url('${f.pragmatica}');font-weight:700}
@font-face{font-family:Roboto;src:url('${f.roboto}');font-weight:500}</style>
<div style="position:absolute;left:${cx - 19}px;top:${cy - 19}px;width:38px;height:38px;border-radius:50%;background:#FF5E1A;border:6px solid #FEF9F3;box-sizing:border-box;box-shadow:0 4px 14px rgba(0,0,0,.45)"></div>
${label ? `<div style="position:absolute;${right};background:#FEF9F3;padding:16px 22px;box-shadow:0 6px 18px rgba(0,0,0,.3);white-space:nowrap">
<div style="font:700 36px 'Pragmatica Extended',sans-serif;letter-spacing:-.01em;color:#1F1915">${esc(label)}</div>
${sublabel ? `<div style="font:500 28px Roboto,sans-serif;color:#525252;margin-top:6px">${esc(sublabel)}</div>` : ''}</div>` : ''}`;
}

/** Render the map (network: OpenFreeMap tiles and MapLibre). Returns the sidecar. */
export async function renderMap({ lat, lon, zoom = 13, label = '', sublabel = '', out }) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) throw new Error('renderMap: lat and lon are required');
  if (!out) throw new Error('renderMap: out is required');
  const { chromium } = createRequire(join(REPO, 'package.json'))('playwright');
  const outFile = resolve(out);
  mkdirSync(dirname(outFile), { recursive: true });
  const stem = basename(outFile, extname(outFile));
  const ext = extname(outFile) || '.png';
  const plain = join(dirname(outFile), `${stem}.plain${ext}`);
  const shot = /\.jpe?g$/i.test(ext) ? { type: 'jpeg', quality: 90 } : {};
  const textures = { paper: dataUrl(join(KIT, 'textures', 'paper.png'), 'image/png'), grain: dataUrl(join(KIT, 'textures', 'grain.png'), 'image/png') };
  const fonts = {
    pragmatica: dataUrl(join(REPO, 'explainers', 'design', 'fonts', 'PragmaticaExtended-Bold.otf'), 'font/otf'),
    roboto: dataUrl(join(REPO, 'explainers', 'design', 'fonts', 'Roboto-500.woff2'), 'font/woff2'),
  };
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: VIEW.w, height: VIEW.h }, deviceScaleFactor: VIEW.scale });
    await page.setContent(mapPage({ lat, lon, zoom }, textures), { waitUntil: 'load' });
    await page.waitForFunction(() => window.mapReady === true, null, { timeout: 60000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: plain, ...shot });
    await page.evaluate((html) => { document.getElementById('marks').innerHTML = html; }, marksHtml({ label, sublabel }, fonts));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    await page.screenshot({ path: outFile, ...shot });
  } finally {
    await browser.close();
  }
  const width = Math.round(VIEW.w * VIEW.scale);
  const height = Math.round(VIEW.h * VIEW.scale);
  const sidecar = { lat: Number(lat), lon: Number(lon), zoom: Number(zoom), label, sublabel, width, height, pin: { x: width / 2, y: height / 2 }, plain: basename(plain) };
  writeFileSync(join(dirname(outFile), `${stem}.map.json`), `${JSON.stringify(sidecar, null, 1)}\n`);
  return { out: outFile, plain, ...sidecar };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  renderMap({ lat: Number(arg('lat')), lon: Number(arg('lon')), zoom: Number(arg('zoom', 13)), label: arg('label', ''), sublabel: arg('sublabel', ''), out: arg('out') })
    .then((r) => console.log(JSON.stringify(r, null, 1)))
    .catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
