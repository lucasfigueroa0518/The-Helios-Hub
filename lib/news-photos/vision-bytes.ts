/**
 * What reaches a vision model (Jev, Claude) is always a JPEG or a PNG. Jev reads only those two
 * (`400 Part "asset-0": first bytes are not a PNG or JPEG signature` on a WebP, set d61efd39), and Claude is told
 * the media type. Anything else (WebP, AVIF, GIF, TIFF…) is re-encoded with sharp at the same width and height, so a
 * box Jev returns (fractions of the picture) stays in the original's frame. No rotation: sharp's width and height,
 * which the band geometry reads, are the stored ones.
 */
import sharp from 'sharp';

export type VisionImage = { bytes: Buffer; mediaType: 'image/jpeg' | 'image/png' };

/** Pure: the format a buffer's first bytes say it is, when it is one a vision model reads as is. */
export function visionFormat(b: Buffer): VisionImage['mediaType'] | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  return null;
}

/** JPEG and PNG pass through untouched; anything else becomes a white-flattened JPEG of the same size. */
export async function visionImage(b: Buffer): Promise<VisionImage> {
  const f = visionFormat(b);
  if (f) return { bytes: b, mediaType: f };
  const bytes = await sharp(b).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  return { bytes, mediaType: 'image/jpeg' };
}
