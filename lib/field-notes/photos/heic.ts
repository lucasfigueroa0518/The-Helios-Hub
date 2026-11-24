/**
 * iPhone photos arrive as HEIC/HEIF; the rest of the hub (lib/image-preprocess.ts, the renderer)
 * only handles JPEG, PNG and WebP. `toJpeg` is the one place that decision lives.
 *
 * Decoder decision (tested 2026-11-04): the prebuilt sharp 0.35.x ships libheif with AV1 only, so it
 * reads AVIF but throws "Support for this compression format has not been built in" on HEVC, which
 * is what an iPhone writes. Tommy: conversion happens as photos are ingested, on the server. So:
 * try sharp (works where its libheif has an HEVC decoder), else `heic-convert` (WASM libheif with
 * HEVC, pure JS, runs on the Linux worker and Vercel). heic-convert returns upright pixels with no
 * EXIF, so the source EXIF block is read separately by `toJpegWithExif` (sharp can read HEIF
 * metadata without decoding). Location is stripped later, on the published copy.
 */
const HEIF_MIMES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
const PLAIN_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const JPEG_QUALITY = 92;

export class UnsupportedImageError extends Error {}

/** HEIC/HEIF by declared type or, for a browser that sends no type, by the `ftyp` brand in the first bytes. */
export function isHeif(buffer: Buffer, mime: string): boolean {
  if (HEIF_MIMES.has(mime.toLowerCase())) return true;
  return buffer.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(buffer.subarray(8, 12).toString('latin1'));
}

async function viaHeicConvert(buffer: Buffer): Promise<Buffer> {
  const convert = (await import('heic-convert')).default;
  const out = await convert({ buffer, format: 'JPEG', quality: JPEG_QUALITY / 100 });
  return Buffer.from(out as ArrayBuffer);
}

/** A JPEG of the upload (pixels upright) and the source's raw EXIF block, when it has one. JPEG passes through unchanged. */
export async function toJpegWithExif(buffer: Buffer, mime: string): Promise<{ jpeg: Buffer; exif: Buffer | undefined }> {
  const sharp = (await import('sharp')).default;
  if (isHeif(buffer, mime)) {
    const exif = await sharp(buffer).metadata().then((m) => m.exif, () => undefined);
    try {
      return { jpeg: await sharp(buffer).keepExif().jpeg({ quality: JPEG_QUALITY }).toBuffer(), exif };
    } catch {
      try {
        return { jpeg: await viaHeicConvert(buffer), exif };
      } catch (e) {
        throw new UnsupportedImageError(`HEIC could not be converted: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const type = mime.toLowerCase();
  if (type === 'image/jpeg') return { jpeg: buffer, exif: (await sharp(buffer).metadata()).exif };
  if (PLAIN_MIMES.has(type)) {
    const jpeg = await sharp(buffer).keepExif().jpeg({ quality: JPEG_QUALITY }).toBuffer();
    return { jpeg, exif: (await sharp(buffer).metadata()).exif };
  }
  throw new UnsupportedImageError(`Unsupported image type ${mime || '(none)'}`);
}

/** The JPEG alone. */
export async function toJpeg(buffer: Buffer, mime: string): Promise<Buffer> {
  return (await toJpegWithExif(buffer, mime)).jpeg;
}
