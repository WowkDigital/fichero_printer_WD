import { describe, expect, it } from 'vitest';
import { buildRaster, packBitmap, type RasterOptions } from './raster';

type Bmp = { width: number; height: number; data: Uint8Array };

/** Build a bitmap from rows of '#' (black) and '.' (white). */
const bmp = (...rows: string[]): Bmp => ({
  width: rows[0].length,
  height: rows.length,
  data: Uint8Array.from(rows.join('').split('').map((c) => (c === '#' ? 1 : 0))),
});
const solid = (width: number, height: number): Bmp => ({ width, height, data: new Uint8Array(width * height).fill(1) });

describe('packBitmap', () => {
  it('packs MSB first with bytesPerRow = headDots / 8', () => {
    const r = packBitmap(bmp('#.......', '.#.....#'), 16);
    expect(r.bytesPerRow).toBe(2);
    expect(r.rows).toBe(2);
    expect(Array.from(r.data)).toEqual([0x80, 0x00, 0x41, 0x00]);
  });

  it('pixel x=0 sets 0x80 of byte 0; x=7 sets 0x01; x=8 sets 0x80 of byte 1', () => {
    expect(Array.from(packBitmap(bmp('#'), 16).data)).toEqual([0x80, 0]);
    expect(Array.from(packBitmap(bmp('.......#'), 16).data)).toEqual([0x01, 0]);
    expect(Array.from(packBitmap(bmp('........#'), 16).data)).toEqual([0, 0x80]);
  });

  it('left alignment is the default', () => {
    expect(Array.from(packBitmap(bmp('##'), 8).data)).toEqual([0xc0]);
  });

  it('center alignment', () => {
    // width 2 on 8 dots: x0 = 3 -> bits 3,4 -> 0b00011000
    expect(Array.from(packBitmap(bmp('##'), 8, 'center').data)).toEqual([0x18]);
  });

  it('right alignment', () => {
    expect(Array.from(packBitmap(bmp('##'), 8, 'right').data)).toEqual([0x03]);
  });

  it('applies offsetDots after alignment (positive and negative)', () => {
    expect(Array.from(packBitmap(bmp('#'), 16, 'left', 9).data)).toEqual([0x00, 0x40]);
    expect(Array.from(packBitmap(bmp('#'), 8, 'right', -2).data)).toEqual([0x04]);
  });

  it('clips bitmaps wider than the head (left aligned)', () => {
    const r = packBitmap(solid(20, 1), 8);
    expect(r.bytesPerRow).toBe(1);
    expect(Array.from(r.data)).toEqual([0xff]);
  });

  it('clips symmetrically when centered and too wide', () => {
    // 12 wide on 8: x0 = -2, source columns 2..9 visible; only source pixel 5 black -> dest x=3
    expect(Array.from(packBitmap(bmp('.....#......'), 8, 'center').data)).toEqual([0x10]);
  });

  it('clips pixels shifted beyond either edge', () => {
    expect(Array.from(packBitmap(bmp('##'), 8, 'left', 7).data)).toEqual([0x01]);
    expect(Array.from(packBitmap(bmp('##'), 8, 'left', -1).data)).toEqual([0x80]);
    expect(Array.from(packBitmap(bmp('##'), 8, 'left', 100).data)).toEqual([0x00]);
    expect(Array.from(packBitmap(bmp('##'), 8, 'left', -100).data)).toEqual([0x00]);
  });

  it('throws when head width is not a multiple of 8 (or not positive)', () => {
    expect(() => packBitmap(bmp('#'), 12)).toThrow(/multiple of 8/);
    expect(() => packBitmap(bmp('#'), 0)).toThrow();
  });
});

const opts = (o: Partial<RasterOptions> = {}): RasterOptions => ({
  headDots: 16,
  align: 'left',
  offsetDots: 0,
  leadRows: 0,
  tailRows: 0,
  bandRows: 0,
  ...o,
});

/** Parse a stream of GS v 0 frames. */
function parseFrames(out: Uint8Array) {
  const frames: { bpr: number; rows: number; payload: Uint8Array }[] = [];
  let i = 0;
  while (i < out.length) {
    expect(Array.from(out.subarray(i, i + 4))).toEqual([0x1d, 0x76, 0x30, 0x00]);
    const bpr = out[i + 4] | (out[i + 5] << 8);
    const rows = out[i + 6] | (out[i + 7] << 8);
    frames.push({ bpr, rows, payload: out.subarray(i + 8, i + 8 + bpr * rows) });
    i += 8 + bpr * rows;
  }
  return frames;
}

describe('buildRaster', () => {
  it('single frame: header and total length', () => {
    const out = buildRaster(solid(16, 3), opts());
    expect(Array.from(out.subarray(0, 8))).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 3, 0]);
    expect(out.length).toBe(8 + 2 * 3);
    expect(Array.from(out.subarray(8))).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  });

  it('adds lead and tail rows to the declared height and places payload after lead', () => {
    const out = buildRaster(solid(16, 2), opts({ leadRows: 2, tailRows: 3 }));
    expect(Array.from(out.subarray(4, 8))).toEqual([2, 0, 7, 0]);
    expect(out.length).toBe(8 + 2 * 7);
    const body = Array.from(out.subarray(8));
    expect(body.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(body.slice(4, 8)).toEqual([0xff, 0xff, 0xff, 0xff]);
    expect(body.slice(8)).toEqual(new Array(6).fill(0));
  });

  it('splits into bands whose rows sum to the total', () => {
    const b = bmp('#...............', '.#..............', '..#.............', '...#............', '....#...........');
    const out = buildRaster(b, opts({ bandRows: 2, leadRows: 1, tailRows: 1 })); // 7 rows
    const frames = parseFrames(out);
    expect(frames.map((f) => f.rows)).toEqual([2, 2, 2, 1]);
    expect(frames.reduce((s, f) => s + f.rows, 0)).toBe(7);
    expect(out.length).toBe(4 * 8 + 7 * 2);
    const body = frames.flatMap((f) => Array.from(f.payload));
    expect(body).toEqual([0, 0, 0x80, 0, 0x40, 0, 0x20, 0, 0x10, 0, 0x08, 0, 0, 0]);
  });

  it('exact multiple of bandRows yields no empty trailing frame', () => {
    const frames = parseFrames(buildRaster(solid(16, 4), opts({ bandRows: 2 })));
    expect(frames.map((f) => f.rows)).toEqual([2, 2]);
  });

  it('auto-splits above 65535 rows when bandRows = 0', () => {
    const frames = parseFrames(buildRaster(solid(8, 65540), opts({ headDots: 8 })));
    expect(frames.map((f) => f.rows)).toEqual([65535, 5]);
  });

  it('uses alignment in the payload', () => {
    const out = buildRaster(bmp('#'), opts({ align: 'right' }));
    expect(Array.from(out.subarray(8))).toEqual([0x00, 0x01]);
  });

  it('negative lead/tail are treated as zero', () => {
    const out = buildRaster(solid(16, 1), opts({ leadRows: -4, tailRows: -1 }));
    expect(out.length).toBe(8 + 2);
  });

  it('propagates the head width error', () => {
    expect(() => buildRaster(solid(8, 1), opts({ headDots: 10 }))).toThrow(/multiple of 8/);
  });
});
