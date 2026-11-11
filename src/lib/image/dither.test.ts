import { describe, expect, it } from 'vitest';
import { applyTone, blackRatio, ditherGray, processRgba, rgbaToGray } from './dither';
import { DEFAULT_TONE, DITHER_MODES, type ToneParams } from './types';

const W = 64;
const H = 48;
const field = (v: number) => new Float32Array(W * H).fill(v);

describe('rgbaToGray', () => {
  it('uses Rec. 601 luminance', () => {
    const g = rgbaToGray(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 3, 1);
    expect(g[0]).toBeCloseTo(76.245, 2);
    expect(g[1]).toBeCloseTo(149.685, 2);
    expect(g[2]).toBeCloseTo(29.07, 2);
  });
  it('composites transparent pixels over white', () => {
    const g = rgbaToGray(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128]), 3, 1);
    expect(g[0]).toBeCloseTo(255);
    expect(g[1]).toBeCloseTo(0);
    expect(g[2]).toBeCloseTo(255 * (127 / 255), 3);
  });
});

describe('applyTone', () => {
  it('is neutral with defaults', () => {
    const src = Float32Array.from([0, 1, 50, 128, 200, 255]);
    const out = applyTone(src, DEFAULT_TONE);
    out.forEach((v, i) => expect(v).toBeCloseTo(src[i], 3));
    expect(out).not.toBe(src);
  });
  it('inverts', () => {
    const out = applyTone(Float32Array.from([0, 100, 255]), { ...DEFAULT_TONE, invert: true });
    expect(Array.from(out)).toEqual([255, 155, 0]);
  });
  it('brightness raises and clamps', () => {
    const out = applyTone(Float32Array.from([100, 250]), { ...DEFAULT_TONE, brightness: 20 });
    expect(out[0]).toBeCloseTo(151, 3);
    expect(out[1]).toBe(255);
  });
  it('gamma > 1 brightens midtones', () => {
    const out = applyTone(Float32Array.from([128]), { ...DEFAULT_TONE, gamma: 2 });
    expect(out[0]).toBeGreaterThan(128);
  });
  it('contrast pushes away from mid gray', () => {
    const out = applyTone(Float32Array.from([100, 160]), { ...DEFAULT_TONE, contrast: 50 });
    expect(out[0]).toBeLessThan(100);
    expect(out[1]).toBeGreaterThan(160);
  });
});

describe('threshold mode', () => {
  it('marks pixels below threshold as black', () => {
    const p: ToneParams = { ...DEFAULT_TONE, dither: 'threshold', threshold: 100 };
    const b = ditherGray(Float32Array.from([0, 99, 100, 255]), 4, 1, p);
    expect(Array.from(b.data)).toEqual([1, 1, 0, 0]);
  });
});

describe.each(DITHER_MODES.map((m) => m.id))('dither mode %s', (mode) => {
  const p: ToneParams = { ...DEFAULT_TONE, dither: mode };
  it('returns 0/1 with correct dimensions', () => {
    const g = new Float32Array(W * H);
    for (let i = 0; i < g.length; i++) g[i] = (i * 7) % 256;
    const b = ditherGray(g, W, H, p);
    expect(b.width).toBe(W);
    expect(b.height).toBe(H);
    expect(b.data.length).toBe(W * H);
    expect(b.data.every((v) => v === 0 || v === 1)).toBe(true);
  });
  it.skipIf(mode === 'threshold')('roughly preserves mean tone on 50% gray', () => {
    const r = blackRatio(ditherGray(field(127.5), W, H, p));
    expect(r).toBeGreaterThan(0.4);
    expect(r).toBeLessThan(0.6);
  });
  it('keeps solid black and white solid', () => {
    expect(blackRatio(ditherGray(field(0), W, H, p))).toBe(1);
    expect(blackRatio(ditherGray(field(255), W, H, p))).toBe(0);
  });
  it.skipIf(mode === 'threshold')('works without serpentine', () => {
    const b = ditherGray(field(127.5), W, H, { ...p, serpentine: false });
    expect(blackRatio(b)).toBeGreaterThan(0.4);
    expect(blackRatio(b)).toBeLessThan(0.6);
  });
});

describe('processRgba', () => {
  it('converts an RGBA image end to end', () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) rgba.set([0, 0, 0, 255], i * 4);
    const b = processRgba(rgba, 4, 4, { ...DEFAULT_TONE, dither: 'threshold' });
    expect(blackRatio(b)).toBe(1);
  });
  it('blackRatio of empty bitmap is 0', () => {
    expect(blackRatio({ width: 0, height: 0, data: new Uint8Array(0) })).toBe(0);
  });
});
