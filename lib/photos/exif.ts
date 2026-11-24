/**
 * What a camera recorded (EXIF), read from the fields each archive returns (SS-22): Wikimedia Commons'
 * `iiprop=metadata` list and NASA's metadata.json. Pure. Moved here from lib/stories/roa/camera.ts (RA-26) so the shared
 * archives sources (./sources/archives.ts) can keep a photo's camera; camera.ts re-exports every name.
 */
import type { PhotoCamera } from './types';

/** Brand names as people write them; EXIF often shouts them or adds "CORPORATION". */
const BRANDS: Record<string, string> = {
  nikon: 'Nikon', canon: 'Canon', sony: 'Sony', fujifilm: 'Fujifilm', fuji: 'Fujifilm', olympus: 'Olympus', panasonic: 'Panasonic',
  leica: 'Leica', pentax: 'Pentax', ricoh: 'Ricoh', samsung: 'Samsung', google: 'Google', apple: 'Apple', hasselblad: 'Hasselblad',
  sigma: 'Sigma', dji: 'DJI', gopro: 'GoPro', huawei: 'Huawei', xiaomi: 'Xiaomi', om: 'OM System', kodak: 'Kodak', minolta: 'Minolta',
};

/** "3900/10" → 390, "8/1" → 8, 100 → 100; anything else → undefined. */
export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  const frac = /^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const d = Number(frac[2]);
    const n = d ? Number(frac[1]) / d : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "NIKON CORPORATION" + "NIKON D7200" → "Nikon D7200"; "Apple" + "iPhone 12 Pro" → "iPhone 12 Pro". */
export function bodyName(make: unknown, model: unknown): string | undefined {
  const mk = typeof make === 'string' ? make.trim() : '';
  let md = typeof model === 'string' ? model.trim().replace(/\s+/g, ' ') : '';
  if (!mk && !md) return undefined;
  const key = mk.toLowerCase().split(/[\s,]+/)[0] ?? '';
  const brand = BRANDS[key] ?? (mk ? mk.replace(/\b(corporation|corp\.?|co\.?,? ?ltd\.?|inc\.?|imaging|optical|company)\b/gi, '').trim() : '');
  if (key && md.toLowerCase().startsWith(key)) md = md.slice(key.length).trim();
  if (/^iphone|^ipad|^pixel/i.test(md)) return md.slice(0, 40);
  // Model names arrive in capitals ("EOS 5D MARK IV"): keep letter-digit codes, soften plain words.
  md = md.replace(/\b([A-Z]{4,})\b/g, (w) => (/\d/.test(w) ? w : w[0] + w.slice(1).toLowerCase()));
  const out = [brand, md].filter(Boolean).join(' ').trim();
  return out ? out.slice(0, 40) : undefined;
}

/** "2022:04:11 07:51:54" or "2022-04-11T…" → "2022-04-11"; a year alone is not a date. */
export function dateOf(v: unknown): string | undefined {
  const m = /\b((?:1[89]|20)\d\d)[:-](\d\d)[:-](\d\d)/.exec(String(v ?? ''));
  if (!m) return undefined;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/**
 * A camera from named EXIF fields (`get` reads one by its EXIF tag name). Undefined when nothing useful is there.
 */
export function cameraFrom(get: (name: string) => unknown): PhotoCamera | undefined {
  const cam: PhotoCamera = {};
  const body = bodyName(get('Make'), get('Model'));
  if (body) cam.body = body;
  const lens = get('LensModel') ?? get('Lens');
  if (typeof lens === 'string' && lens.trim()) cam.lens = lens.trim().slice(0, 60);
  const focal = num(get('FocalLength'));
  if (focal) cam.focalMm = Math.round(focal * 10) / 10;
  const f = num(get('FNumber'));
  if (f) cam.fNumber = Math.round(f * 10) / 10;
  const exp = num(get('ExposureTime'));
  if (exp) cam.exposureS = exp;
  const iso = num(get('ISOSpeedRatings') ?? get('ISO') ?? get('PhotographicSensitivity'));
  if (iso) cam.iso = Math.round(iso);
  const taken = dateOf(get('DateTimeOriginal') ?? get('DateTimeDigitized'));
  if (taken) cam.taken = taken;
  return Object.keys(cam).length ? cam : undefined;
}

/** Commons `iiprop=metadata`: [{ name, value }]. */
export function commonsCamera(metadata: unknown): PhotoCamera | undefined {
  if (!Array.isArray(metadata)) return undefined;
  const map = new Map<string, unknown>();
  for (const m of metadata) if (m && typeof m === 'object' && typeof (m as { name?: unknown }).name === 'string') map.set((m as { name: string }).name, (m as { value?: unknown }).value);
  return cameraFrom((n) => map.get(n));
}

/** NASA's metadata.json: "EXIF:Model", "Composite:LensID", … */
export function nasaCamera(meta: unknown): PhotoCamera | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const o = meta as Record<string, unknown>;
  const read = (n: string) => o[`EXIF:${n}`] ?? o[`Composite:${n}`] ?? o[`XMP:${n}`];
  return cameraFrom((n) => (n === 'LensModel' ? read('LensModel') ?? o['Composite:LensID'] : n === 'ISOSpeedRatings' ? read('ISO') : read(n)));
}
