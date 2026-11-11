/** Packs 1-bit bitmaps into ESC/POS GS v 0 raster frames. */
import type { Bitmap1 } from '../image/types';
import { Cmd, MAX_FRAME_ROWS } from './protocol';

export type Align = 'left' | 'center' | 'right';

export interface RasterOptions {
  /** Head width in dots; must be a multiple of 8. */
  headDots: number;
  align: Align;
  /** Extra horizontal shift in dots, applied after alignment (can be negative). */
  offsetDots: number;
  /** Blank rows before the image. */
  leadRows: number;
  /** Blank rows after the image (tear-bar margin). */
  tailRows: number;
  /** Rows per GS v 0 frame; 0 = one frame for the whole job (auto-split above 65535 rows). */
  bandRows: number;
}

export interface PackedRaster {
  bytesPerRow: number;
  rows: number;
  /** Row-major, MSB first, 1 = black. */
  data: Uint8Array;
}

/** Place a bitmap on the head width and pack it to 1 bit per pixel. Pixels outside the head are clipped. */
export function packBitmap(bmp: Bitmap1, headDots: number, align: Align = 'left', offsetDots = 0): PackedRaster {
  if (headDots <= 0 || headDots % 8 !== 0) throw new Error('Head width must be a positive multiple of 8 dots');
  const bytesPerRow = headDots / 8;
  const base = align === 'center' ? Math.floor((headDots - bmp.width) / 2) : align === 'right' ? headDots - bmp.width : 0;
  const x0 = base + Math.round(offsetDots);
  const data = new Uint8Array(bytesPerRow * bmp.height);
  const srcStart = Math.max(0, -x0);
  const srcEnd = Math.min(bmp.width, headDots - x0);
  for (let y = 0; y < bmp.height; y++) {
    const srcRow = y * bmp.width;
    const dstRow = y * bytesPerRow;
    for (let sx = srcStart; sx < srcEnd; sx++) {
      if (bmp.data[srcRow + sx]) {
        const dx = x0 + sx;
        data[dstRow + (dx >> 3)] |= 0x80 >> (dx & 7);
      }
    }
  }
  return { bytesPerRow, rows: bmp.height, data };
}

/** Build the full byte stream for a print job: one or more GS v 0 frames including blank lead/tail rows. */
export function buildRaster(bmp: Bitmap1, opts: RasterOptions): Uint8Array {
  const packed = packBitmap(bmp, opts.headDots, opts.align, opts.offsetDots);
  const lead = Math.max(0, Math.round(opts.leadRows));
  const tail = Math.max(0, Math.round(opts.tailRows));
  const totalRows = lead + packed.rows + tail;
  const bpr = packed.bytesPerRow;
  const body = new Uint8Array(totalRows * bpr);
  body.set(packed.data, lead * bpr);

  const band = opts.bandRows > 0 ? Math.min(Math.round(opts.bandRows), MAX_FRAME_ROWS) : MAX_FRAME_ROWS;
  const frames = Math.max(1, Math.ceil(totalRows / band));
  const out = new Uint8Array(frames * 8 + body.length);
  let offset = 0;
  for (let row = 0; row < totalRows || offset === 0; row += band) {
    const rows = Math.min(band, totalRows - row);
    out.set(Cmd.rasterHeader(bpr, rows), offset);
    offset += 8;
    out.set(body.subarray(row * bpr, (row + rows) * bpr), offset);
    offset += rows * bpr;
    if (totalRows === 0) break;
  }
  return out;
}
