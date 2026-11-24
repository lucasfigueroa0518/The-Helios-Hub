/**
 * Photo prep: EXIF-oriented, cover-fitted to the 1080x1350 canvas (full bleed), metadata stripped
 * (location never reaches a published image). All placement and contrast analysis runs on this
 * prepared canvas, so every Rect is in canvas pixels.
 */
import type { Rect } from '../types';
import type { RawImage } from './contrast';

export const CANVAS_W = 1080;
export const CANVAS_H = 1350;

/**
 * A reframe: cover-fit the photo, zoom in by `zoom` (1 to about 1.15), and shift the window across the
 * slack the crop leaves. fx and fy are 0 to 1 along the slack on each axis (0.5 is the centre crop).
 */
export type Reframe = { zoom: number; fx: number; fy: number };
export const CENTER_FRAME: Reframe = { zoom: 1, fx: 0.5, fy: 0.5 };
export const MAX_REFRAME_ZOOM = 1.15;

export type PreparedPhoto = {
  jpeg: Buffer;
  raw: RawImage;
  width: number;
  height: number;
  /** The crop this is (the centre crop unless the layout reframed). */
  frame: Reframe;
  /** The EXIF-oriented source size, which `mapRectBetweenFrames` needs. */
  src: { w: number; h: number };
};

/** Face boxes come in canvas pixels, from the cover-fitted JPEG (the injected detector sees exactly that image). */
export type DetectFaces = (image: Buffer) => Promise<Rect[]>;

export function frameGeometry(src: { w: number; h: number }, frame: Reframe) {
  const scale = Math.max(CANVAS_W / src.w, CANVAS_H / src.h) * frame.zoom;
  const sw = Math.max(CANVAS_W, Math.round(src.w * scale));
  const sh = Math.max(CANVAS_H, Math.round(src.h * scale));
  return { scale: sw / src.w, scaleY: sh / src.h, sw, sh, ox: Math.round(frame.fx * (sw - CANVAS_W)), oy: Math.round(frame.fy * (sh - CANVAS_H)) };
}

/** Moves a rect (canvas px) from one crop of the same photo to another. */
export function mapRectBetweenFrames(r: Rect, from: PreparedPhoto, toFrame: Reframe): Rect {
  const a = frameGeometry(from.src, from.frame);
  const b = frameGeometry(from.src, toFrame);
  const x0 = ((r.x + a.ox) / a.scale) * b.scale - b.ox;
  const y0 = ((r.y + a.oy) / a.scaleY) * b.scaleY - b.oy;
  const x1 = ((r.x + r.w + a.ox) / a.scale) * b.scale - b.ox;
  const y1 = ((r.y + r.h + a.oy) / a.scaleY) * b.scaleY - b.oy;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export async function preparePhoto(photo: Buffer, frame: Reframe = CENTER_FRAME): Promise<PreparedPhoto> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(photo).metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  const src = { w: (swap ? meta.height : meta.width) ?? CANVAS_W, h: (swap ? meta.width : meta.height) ?? CANVAS_H };
  const g = frameGeometry(src, frame);
  const jpeg = await sharp(photo)
    .rotate() // EXIF orientation
    .resize(g.sw, g.sh, { fit: 'fill' })
    .extract({ left: Math.min(g.ox, g.sw - CANVAS_W), top: Math.min(g.oy, g.sh - CANVAS_H), width: CANVAS_W, height: CANVAS_H })
    .removeAlpha()
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer(); // no withMetadata(): EXIF/GPS dropped
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  return { jpeg, raw: { data: new Uint8Array(data), width: info.width, height: info.height, channels: info.channels as 3 }, width: info.width, height: info.height, frame, src };
}

/** Decode any PNG/JPEG buffer to raw RGB (for the rendered-pixel checks). */
export async function decodeRaw(image: Buffer): Promise<RawImage> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height, channels: info.channels as 3 };
}

/** Normalised (0-1) face boxes, as fit-check's detector returns them, to canvas pixels. */
export function faceBoxesToRects(boxes: Array<{ x: number; y: number; w: number; h: number }>): Rect[] {
  return boxes.map((b) => ({ x: b.x * CANVAS_W, y: b.y * CANVAS_H, w: b.w * CANVAS_W, h: b.h * CANVAS_H }));
}
