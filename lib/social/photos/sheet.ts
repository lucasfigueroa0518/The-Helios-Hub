/**
 * The candidate contact sheet (photo spec §4 step 4): every candidate photo
 * of a post on numbered sheets, at most 16 tiles each (4 × 4, 384 px tiles on
 * a 1536 px square), for one Haiku tagging call per sheet. Each tile shows
 * the whole photo (contain, on dark grey) with its number in the top-left
 * corner; a photo that doesn't load becomes a blank tile and is reported.
 *
 * Plain code (sharp), the same canvas-and-composite pattern as the render
 * check's contact sheet (render/fit-check.ts).
 */
const COLS = 4;
export const TILES_PER_SHEET = COLS * COLS;
const TILE = 384;
const PAD = 8;
const SIDE = COLS * TILE;
const USER_AGENT = 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';

export type Sheet = {
  png: Buffer;
  /** The candidate URLs on this sheet, in tile order (tile 1 first). */
  urls: string[];
  /** Tile numbers (1-based) whose photo didn't load. */
  failed: number[];
};

const label = (n: number) =>
  Buffer.from(`<svg width="64" height="44" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="44" rx="6" fill="#000" fill-opacity="0.8"/><text x="32" y="31" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" fill="#fff" text-anchor="middle">${n}</text></svg>`);

async function tile(url: string, http: typeof fetch): Promise<Buffer | null> {
  try {
    const res = await http(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const sharp = (await import('sharp')).default;
    return await sharp(Buffer.from(await res.arrayBuffer()))
      .rotate()
      .resize(TILE - 2 * PAD, TILE - 2 * PAD, { fit: 'contain', background: { r: 34, g: 34, b: 34, alpha: 1 } })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/** The sheets for these URLs, in order: tile n of sheet k is URL k·16 + n. */
export async function buildSheets(urls: string[], opts: { http?: typeof fetch } = {}): Promise<Sheet[]> {
  const http = opts.http ?? fetch;
  const sharp = (await import('sharp')).default;
  const sheets: Sheet[] = [];
  for (let start = 0; start < urls.length; start += TILES_PER_SHEET) {
    const chunk = urls.slice(start, start + TILES_PER_SHEET);
    const images = await Promise.all(chunk.map((u) => tile(u, http)));
    const layers = images.flatMap((img, i) => {
      const left = (i % COLS) * TILE;
      const top = Math.floor(i / COLS) * TILE;
      return [...(img ? [{ input: img, left: left + PAD, top: top + PAD }] : []), { input: label(i + 1), left: left + PAD + 6, top: top + PAD + 6 }];
    });
    const png = await sharp({ create: { width: SIDE, height: SIDE, channels: 3, background: { r: 17, g: 17, b: 17 } } }).composite(layers).png().toBuffer();
    sheets.push({ png, urls: chunk, failed: images.flatMap((img, i) => (img ? [] : [i + 1])) });
  }
  return sheets;
}
