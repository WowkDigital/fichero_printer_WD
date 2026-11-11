/** Small helpers for building and measuring 1-bit bitmaps. Framework-free. */
import type { Bitmap1 } from './types';

export function blankBitmap(width: number, height: number): Bitmap1 {
  const w = Math.max(0, Math.round(width));
  const h = Math.max(0, Math.round(height));
  return { width: w, height: h, data: new Uint8Array(w * h) };
}

/**
 * Stack bitmaps top to bottom on a canvas `width` wide, each one horizontally centred
 * (or clipped when wider). `gap` blank rows go between consecutive parts.
 */
export function stackBitmaps(parts: Bitmap1[], width: number, gap = 0): Bitmap1 {
  const g = Math.max(0, Math.round(gap));
  const height = parts.reduce((sum, p) => sum + p.height, 0) + g * Math.max(0, parts.length - 1);
  const out = blankBitmap(width, height);
  let y0 = 0;
  for (const part of parts) {
    const x0 = Math.floor((out.width - part.width) / 2);
    const from = Math.max(0, -x0);
    const to = Math.min(part.width, out.width - x0);
    for (let y = 0; y < part.height; y++) {
      const src = y * part.width;
      const dst = (y0 + y) * out.width + x0;
      for (let x = from; x < to; x++) out.data[dst + x] = part.data[src + x];
    }
    y0 += part.height + g;
  }
  return out;
}

/** Keep only the first `rows` rows. */
export function cropRows(bmp: Bitmap1, rows: number): Bitmap1 {
  const h = Math.max(0, Math.min(bmp.height, Math.round(rows)));
  if (h === bmp.height) return bmp;
  return { width: bmp.width, height: h, data: bmp.data.slice(0, h * bmp.width) };
}

export interface InkBounds {
  left: number;
  top: number;
  /** Exclusive. */
  right: number;
  /** Exclusive. */
  bottom: number;
}

/** Bounding box of the black pixels, or null for an all-white bitmap. */
export function inkBounds(bmp: Bitmap1): InkBounds | null {
  const { width, height, data } = bmp;
  let left = width;
  let right = -1;
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let first = -1;
    for (let x = 0; x < width; x++) {
      if (data[row + x]) {
        first = x;
        break;
      }
    }
    if (first < 0) continue;
    if (top < 0) top = y;
    bottom = y;
    if (first < left) left = first;
    for (let x = width - 1; x > right; x--) {
      if (data[row + x]) {
        right = x;
        break;
      }
    }
  }
  if (top < 0) return null;
  return { left, top, right: right + 1, bottom: bottom + 1 };
}
