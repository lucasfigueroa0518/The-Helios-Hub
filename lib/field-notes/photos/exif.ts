/**
 * The few EXIF facts Field Notes keeps about an uploaded photo: when it was taken, with what
 * camera, how it is turned, and whether it carried a location. Pure: reads the raw EXIF block
 * (what sharp's `metadata().exif` returns); never keeps a coordinate.
 */

export type PhotoExif = {
  /** Local capture time, `YYYY-MM-DDTHH:MM:SS`, plus the UTC offset when the camera wrote one. */
  capturedAt: string | null;
  camera: string | null;
  /** EXIF orientation 1-8. */
  orientation: number | null;
  /** The upload carried a GPS block. The coordinates are never stored. */
  hadLocation: boolean;
};

export const NO_EXIF: PhotoExif = { capturedAt: null, camera: null, orientation: null, hadLocation: false };

const TAG = { make: 0x010f, model: 0x0110, orientation: 0x0112, exifIfd: 0x8769, gpsIfd: 0x8825, dateTimeOriginal: 0x9003, offsetTimeOriginal: 0x9011 } as const;
const TYPE_BYTES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4 };

type Entry = { type: number; count: number; valueAt: number };

/** The entries of the IFD at `offset` (a TIFF-relative position), by tag. Malformed data yields what was readable. */
function readIfd(tiff: Buffer, offset: number, little: boolean): Map<number, Entry> {
  const entries = new Map<number, Entry>();
  if (offset < 8 || offset + 2 > tiff.length) return entries;
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const n = u16(offset);
  for (let i = 0; i < n; i++) {
    const at = offset + 2 + i * 12;
    if (at + 12 > tiff.length) break;
    const type = u16(at + 2);
    const count = u32(at + 4);
    const size = (TYPE_BYTES[type] ?? 0) * count;
    const valueAt = size <= 4 ? at + 8 : u32(at + 8);
    if (size > 0 && valueAt + size <= tiff.length) entries.set(u16(at), { type, count, valueAt });
  }
  return entries;
}

function parse(exif: Buffer): PhotoExif {
  const tiff = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? exif.subarray(6) : exif;
  const order = tiff.subarray(0, 2).toString('latin1');
  if (tiff.length < 8 || (order !== 'II' && order !== 'MM')) return NO_EXIF;
  const little = order === 'II';
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ascii = (e: Entry | undefined) => (e && e.type === 2 ? tiff.subarray(e.valueAt, e.valueAt + e.count).toString('latin1').replace(/\0.*$/s, '').trim() : '');

  const ifd0 = readIfd(tiff, u32(4), little);
  const exifPointer = ifd0.get(TAG.exifIfd);
  const sub = exifPointer ? readIfd(tiff, u32(exifPointer.valueAt), little) : new Map<number, Entry>();

  const make = ascii(ifd0.get(TAG.make));
  const model = ascii(ifd0.get(TAG.model));
  const camera = model ? (model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim()) : make || null;

  const o = ifd0.get(TAG.orientation);
  const orientation = o && o.type === 3 && u16(o.valueAt) >= 1 && u16(o.valueAt) <= 8 ? u16(o.valueAt) : null;

  const taken = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(ascii(sub.get(TAG.dateTimeOriginal)));
  const offset = /^[+-]\d{2}:\d{2}$/.test(ascii(sub.get(TAG.offsetTimeOriginal))) ? ascii(sub.get(TAG.offsetTimeOriginal)) : '';
  const capturedAt = taken ? `${taken[1]}-${taken[2]}-${taken[3]}T${taken[4]}:${taken[5]}:${taken[6]}${offset}` : null;

  return { capturedAt, camera: camera || null, orientation, hadLocation: ifd0.has(TAG.gpsIfd) };
}

/** Reads a raw EXIF block; an absent or unreadable one gives no facts rather than an error. */
export function parseExif(exif: Buffer | undefined | null): PhotoExif {
  if (!exif) return NO_EXIF;
  try {
    return parse(exif);
  } catch {
    return NO_EXIF;
  }
}
