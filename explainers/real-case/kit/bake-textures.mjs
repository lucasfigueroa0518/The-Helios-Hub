// Bake the kit's surface textures to seamless PNG tiles (repo tool; jobs get only the PNGs).
//
// HyperFrames composites an element with a CSS `filter: url(#…)` even while its frame is hidden, so a
// filtered texture from one frame shows through every other frame. The kit therefore never filters a
// live element: cork, paper grain, film grain and the ink masks are these tiles, made once from the same
// seeded turbulence.
//
//   node explainers/real-case/kit/bake-textures.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { open } from './browser.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'textures');
const S = 512;

/** name → [filter body, base fill under the filter ('none' = transparent, alpha tile)]. */
export const TEXTURES = {
  cork: [`<feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="3" seed="7" stitchTiles="stitch" result="a"/>
    <feColorMatrix in="a" values="0 0 0 0 0.16  0 0 0 0 0.09  0 0 0 0 0.03  0 0 0 4.2 -2.0" result="dark"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.3" numOctaves="2" seed="19" stitchTiles="stitch" result="b"/>
    <feColorMatrix in="b" values="0 0 0 0 0.92  0 0 0 0 0.72  0 0 0 0 0.46  0 0 0 4.0 -2.3" result="light"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.0156" numOctaves="2" seed="2" stitchTiles="stitch" result="c"/>
    <feColorMatrix in="c" values="0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0 0.1  0 0 0 0.6 -0.1" result="mottle"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="mottle"/><feMergeNode in="dark"/><feMergeNode in="light"/></feMerge>`, '#8E6136'],
  paper: [`<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" stitchTiles="stitch"/>
    <feColorMatrix values="0 0 0 0 0.55  0 0 0 0 0.5  0 0 0 0 0.42  0 0 0 0.5 0"/>`, 'none'],
  grain: [`<feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="11" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/>`, '#888'],
  // Masks: white where ink stays, transparent where it drops out.
  ink: [`<feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="4" stitchTiles="stitch" result="n"/>
    <feColorMatrix in="n" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -2.2 1.4"/>`, 'none'],
  dryerase: [`<feTurbulence type="fractalNoise" baseFrequency="0.0117 0.35" numOctaves="2" seed="9" stitchTiles="stitch" result="s"/>
    <feColorMatrix in="s" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.6 0.25"/>`, 'none'],
};

export async function bake() {
  const b = await open(process.cwd());
  if (!b.page) throw new Error(`no browser: ${b.skipped}`);
  mkdirSync(OUT, { recursive: true });
  try {
    for (const [name, [body, fill]] of Object.entries(TEXTURES)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><filter id="f" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">${body}</filter><rect width="${S}" height="${S}" fill="${fill === 'none' ? 'transparent' : fill}" filter="url(#f)"/></svg>`;
      const png = await b.page.evaluate(async ({ svg, S }) => {
        const img = new Image();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.toDataURL('image/png');
      }, { svg, S });
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
      console.log(`  textures/${name}.png`);
    }
  } finally {
    await b.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) bake();
