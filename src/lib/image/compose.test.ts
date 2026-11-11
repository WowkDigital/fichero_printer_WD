import { describe, expect, it } from 'vitest';
import { blankBitmap, cropRows, inkBounds, stackBitmaps } from './compose';
import type { Bitmap1 } from './types';

function bmp(rows: string[]): Bitmap1 {
  const width = rows[0].length;
  return { width, height: rows.length, data: Uint8Array.from(rows.join('').split(''), (c) => (c === '#' ? 1 : 0)) };
}

describe('inkBounds', () => {
  it('returns null for blank bitmaps', () => {
    expect(inkBounds(blankBitmap(5, 5))).toBeNull();
  });
  it('finds the black bounding box', () => {
    expect(inkBounds(bmp(['.....', '..#..', '.#...', '.....']))).toEqual({ left: 1, top: 1, right: 3, bottom: 3 });
  });
});

describe('stackBitmaps', () => {
  it('stacks with gaps and centres narrow parts', () => {
    const out = stackBitmaps([bmp(['##']), bmp(['####'])], 4, 1);
    expect(out.height).toBe(3);
    expect(Array.from(out.data)).toEqual([0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  });
  it('clips parts wider than the canvas', () => {
    const out = stackBitmaps([bmp(['#..#'])], 2);
    expect(Array.from(out.data)).toEqual([0, 0]);
  });
});

describe('cropRows', () => {
  it('keeps the first rows', () => {
    const out = cropRows(bmp(['#.', '.#', '##']), 2);
    expect(out.height).toBe(2);
    expect(Array.from(out.data)).toEqual([1, 0, 0, 1]);
  });
});
