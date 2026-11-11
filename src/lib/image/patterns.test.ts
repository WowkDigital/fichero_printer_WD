import { describe, expect, it } from 'vitest';
import { blackRatio } from './dither';
import { PATTERNS, generatePattern, type PatternId } from './patterns';
import { DEFAULT_TONE, DITHER_MODES } from './types';

describe.each(PATTERNS.map((p) => p.id))('pattern %s', (id) => {
  for (const [width, height] of [
    [1632, 200],
    [1680, 37],
    [100, 100],
  ]) {
    it(`has exact dimensions ${width}x${height} and only 0/1`, () => {
      const b = generatePattern(id, { width, height, cell: 8, tone: DEFAULT_TONE });
      expect(b.width).toBe(width);
      expect(b.height).toBe(height);
      expect(b.data.length).toBe(width * height);
      expect(b.data.every((v) => v === 0 || v === 1)).toBe(true);
      const r = blackRatio(b);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(1);
    });
  }
});

describe('pattern content', () => {
  const gen = (id: PatternId, w = 64, h = 64, cell = 4) =>
    generatePattern(id, { width: w, height: h, cell, tone: DEFAULT_TONE });

  it('checker alternates', () => {
    const b = gen('checker');
    expect(b.data[0]).toBe(1);
    expect(b.data[4]).toBe(0);
    expect(b.data[4 * 64]).toBe(0);
    expect(b.data[4 * 64 + 4]).toBe(1);
  });
  it('stripes alternate', () => {
    expect(gen('v-stripes').data[0]).toBe(1);
    expect(gen('v-stripes').data[4]).toBe(0);
    expect(gen('h-stripes').data[0]).toBe(1);
    expect(gen('h-stripes').data[4 * 64]).toBe(0);
  });
  it('grid has lines', () => {
    const b = gen('grid');
    expect(b.data[1]).toBe(1);
    expect(b.data[64 + 4]).toBe(1);
    expect(b.data[64 + 1]).toBe(0);
  });
  it('border covers edges and corners', () => {
    const b = gen('border', 100, 60);
    expect(b.data[0]).toBe(1);
    expect(b.data[99]).toBe(1);
    expect(b.data[59 * 100]).toBe(1);
    expect(b.data[59 * 100 + 99]).toBe(1);
    expect(b.data[30 * 100 + 1]).toBe(1);
    expect(b.data[30 * 100 + 98]).toBe(1);
  });
  it('ruler ticks every 8 dots with longer 5 mm and 10 mm ticks', () => {
    const b = gen('ruler', 200, 40);
    const colHeight = (x: number) => {
      let n = 0;
      for (let y = 0; y < 40; y++) n += b.data[y * 200 + x];
      return n;
    };
    expect(colHeight(8)).toBeGreaterThan(1);
    expect(colHeight(4)).toBe(1);
    expect(colHeight(40)).toBeGreaterThan(colHeight(8));
    expect(colHeight(80)).toBeGreaterThan(colHeight(40));
  });
  it('solid bars start with a 1 dot bar then a gap', () => {
    const b = gen('solid-bars', 32, 200);
    expect(b.data[0]).toBe(1);
    expect(b.data[32]).toBe(0);
  });
  it('gray ladder goes from white to black', () => {
    const b = gen('gray-ladder', 64, 110);
    let top = 0;
    let bottom = 0;
    for (let x = 0; x < 64; x++) {
      top += b.data[x];
      bottom += b.data[109 * 64 + x];
    }
    expect(top).toBe(0);
    expect(bottom).toBe(64);
  });
  it('gradient is dark on the left, light on the right', () => {
    const b = gen('gradient', 256, 32);
    let left = 0;
    let right = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 64; x++) {
        left += b.data[y * 256 + x];
        right += b.data[y * 256 + 192 + x];
      }
    }
    expect(left).toBeGreaterThan(right);
  });
  it('dithered patterns work with every dither mode', () => {
    for (const m of DITHER_MODES) {
      const b = generatePattern('gradient', {
        width: 80,
        height: 20,
        cell: 4,
        tone: { ...DEFAULT_TONE, dither: m.id },
      });
      expect(b.data.length).toBe(1600);
    }
  });
});
