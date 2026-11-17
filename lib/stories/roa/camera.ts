/**
 * The reveal cards built by code: the camera card for a real photo (RA-26), read from the source's EXIF fields, and the
 * origin card for an AI image with no prompt to show (RA-27). Pure: real.ts feeds the EXIF fields each source returns;
 * the set builder calls receiptOf and originOf.
 */
import { dateOf } from '@/lib/photos/exif';

import type { Provenance, Receipt } from './types';

/** The EXIF readers live with the shared archives sources since the Stories Split (SS-22); re-exported for callers here. */
export { bodyName, cameraFrom, commonsCamera, dateOf, nasaCamera, num } from '@/lib/photos/exif';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 0.0015625 → "1/640 s"; 2 → "2 s"; 0.5 → "1/2 s". */
export function shutter(s: number): string {
  if (s >= 1) return `${Math.round(s * 10) / 10} s`;
  return `1/${Math.round(1 / s)} s`;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/**
 * The camera card (RA-26), from the provenance: the camera, the settings, then when and where. The heading says
 * "Shot on" when the camera is known, else "Taken". Null when there is nothing to show.
 */
export function receiptOf(p: Provenance): Receipt | null {
  if (p.kind !== 'bank' && p.kind !== 'commons' && p.kind !== 'nasa') return null;
  const c = p.camera ?? {};
  const settings = [
    c.focalMm ? `${fmt(c.focalMm)} mm` : '',
    c.fNumber ? `f/${fmt(c.fNumber)}` : '',
    c.exposureS ? shutter(c.exposureS) : '',
    c.iso ? `ISO ${c.iso}` : '',
  ].filter(Boolean).join(' · ');
  const when = c.taken ? `${MONTHS[Number(c.taken.slice(5, 7)) - 1]} ${c.taken.slice(0, 4)}` : (p.year ?? '');
  const whenWhere = [when, (p.place ?? '').trim()].filter(Boolean).join(' · ');
  const rows = [c.body ?? '', settings, whenWhere].filter(Boolean);
  if (!rows.length) return null;
  return { head: c.body || settings ? 'Shot on' : 'Taken', rows };
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/**
 * The origin card (RA-27): an AI image whose reveal has no prompt and no effort line says what made it and where it
 * came from. Always has rows for an AI provenance; null for a real one.
 */
export function originOf(p: Provenance): Receipt | null {
  if (p.kind !== 'generated' && p.kind !== 'dataset' && p.kind !== 'viral') return null;
  const model = clip((p.model ?? '').trim(), 40) || 'An AI image model';
  if (p.kind === 'generated') return { head: 'Made with', rows: [model] };
  if (p.kind === 'dataset') return { head: 'Made with', rows: [model, clip(`From the ${p.dataset.trim()} dataset`, 48)] };
  const seen = dateOf(p.firstSeen);
  return { head: 'Made with', rows: [model, seen ? `Shared online · ${MONTHS[Number(seen.slice(5, 7)) - 1]} ${seen.slice(0, 4)}` : 'Shared online'] };
}
