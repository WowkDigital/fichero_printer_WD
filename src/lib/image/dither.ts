import type { Bitmap1, DitherMode, ToneParams } from './types';

/** Luminance 0..255 (Rec. 601); transparent pixels are composited over white. */
export function rgbaToGray(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const n = width * height;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const lum = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    const a = rgba[j + 3];
    out[i] = a === 255 ? lum : (lum * a + 255 * (255 - a)) / 255;
  }
  return out;
}

/** Brightness, contrast, gamma, invert (in that order). Returns a new array clamped to 0..255. */
export function applyTone(gray: Float32Array, p: ToneParams): Float32Array {
  const n = gray.length;
  const out = new Float32Array(n);
  const bOff = p.brightness * 2.55;
  const c = p.contrast * 2.55;
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  const gammaOn = p.gamma !== 1 && p.gamma > 0;
  const invG = gammaOn ? 1 / p.gamma : 1;
  const inv = p.invert;
  for (let i = 0; i < n; i++) {
    let v = gray[i] + bOff;
    v = cf * (v - 128) + 128;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    if (gammaOn) v = 255 * Math.pow(v / 255, invG);
    if (inv) v = 255 - v;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

interface Kernel {
  dx: Int8Array;
  dy: Int8Array;
  w: Float32Array;
}

function kernel(div: number, taps: [number, number, number][]): Kernel {
  return {
    dx: Int8Array.from(taps.map((t) => t[0])),
    dy: Int8Array.from(taps.map((t) => t[1])),
    w: Float32Array.from(taps.map((t) => t[2] / div)),
  };
}

const KERNELS: Partial<Record<DitherMode, Kernel>> = {
  'floyd-steinberg': kernel(16, [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]]),
  atkinson: kernel(8, [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]]),
  jarvis: kernel(48, [
    [1, 0, 7], [2, 0, 5],
    [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
    [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
  ]),
  stucki: kernel(42, [
    [1, 0, 8], [2, 0, 4],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
    [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
  ]),
  burkes: kernel(32, [
    [1, 0, 8], [2, 0, 4],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
  ]),
  sierra: kernel(32, [
    [1, 0, 5], [2, 0, 3],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
    [-1, 2, 2], [0, 2, 3], [1, 2, 2],
  ]),
};

function bayerMatrix(n: number): Float32Array {
  let m = [0];
  let size = 1;
  while (size < n) {
    const ns = size * 2;
    const next = new Array<number>(ns * ns);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = 4 * m[y * size + x];
        next[y * ns + x] = v;
        next[y * ns + x + size] = v + 2;
        next[(y + size) * ns + x] = v + 3;
        next[(y + size) * ns + x + size] = v + 1;
      }
    }
    m = next;
    size = ns;
  }
  const total = n * n;
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) out[i] = ((m[i] + 0.5) / total) * 255;
  return out;
}

const BAYER_CACHE = new Map<number, Float32Array>();
function getBayer(n: number): Float32Array {
  let m = BAYER_CACHE.get(n);
  if (!m) {
    m = bayerMatrix(n);
    BAYER_CACHE.set(n, m);
  }
  return m;
}

function errorDiffusion(
  gray: Float32Array,
  width: number,
  height: number,
  k: Kernel,
  p: ToneParams,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const buf = new Float32Array(gray);
  const thr = p.threshold;
  const { dx, dy, w } = k;
  const taps = w.length;
  for (let y = 0; y < height; y++) {
    const rtl = p.serpentine && (y & 1) === 1;
    const dir = rtl ? -1 : 1;
    const start = rtl ? width - 1 : 0;
    for (let s = 0, x = start; s < width; s++, x += dir) {
      const idx = y * width + x;
      const v = buf[idx];
      let err: number;
      if (v < thr) {
        out[idx] = 1;
        err = v;
      } else {
        err = v - 255;
      }
      if (err === 0) continue;
      for (let t = 0; t < taps; t++) {
        const nx = x + dx[t] * dir;
        const ny = y + dy[t];
        if (nx < 0 || nx >= width || ny >= height) continue;
        buf[ny * width + nx] += err * w[t];
      }
    }
  }
  return out;
}

function ordered(
  gray: Float32Array,
  width: number,
  height: number,
  n: number,
  bias: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const m = getBayer(n);
  const mask = n - 1;
  for (let y = 0; y < height; y++) {
    const row = (y & mask) * n;
    const base = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[base + x] + bias < m[row + (x & mask)]) out[base + x] = 1;
    }
  }
  return out;
}

function halftone(
  gray: Float32Array,
  width: number,
  height: number,
  cell: number,
  bias: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const k = (Math.PI * 2) / Math.max(2, cell);
  const s = Math.SQRT1_2 * k;
  for (let y = 0; y < height; y++) {
    const base = y * width;
    const yy = y + 0.5;
    for (let x = 0; x < width; x++) {
      const xx = x + 0.5;
      const u = (xx + yy) * s;
      const v = (yy - xx) * s;
      // 0 at dot centres, 1 at cell corners
      const spot = 0.5 - (Math.cos(u) + Math.cos(v)) * 0.25;
      let d = 1 - (gray[base + x] + bias) / 255;
      if (d > 1) d = 1;
      if (d > 0 && d >= spot) out[base + x] = 1;
    }
  }
  return out;
}

export function ditherGray(
  gray: Float32Array,
  width: number,
  height: number,
  p: ToneParams,
): Bitmap1 {
  let data: Uint8Array;
  const bias = 128 - p.threshold;
  switch (p.dither) {
    case 'threshold': {
      data = new Uint8Array(width * height);
      const thr = p.threshold;
      for (let i = 0; i < data.length; i++) if (gray[i] < thr) data[i] = 1;
      break;
    }
    case 'bayer2':
      data = ordered(gray, width, height, 2, bias);
      break;
    case 'bayer4':
      data = ordered(gray, width, height, 4, bias);
      break;
    case 'bayer8':
      data = ordered(gray, width, height, 8, bias);
      break;
    case 'halftone':
      data = halftone(gray, width, height, p.halftoneCell, bias);
      break;
    default: {
      const k = KERNELS[p.dither] ?? KERNELS['floyd-steinberg']!;
      data = errorDiffusion(gray, width, height, k, p);
    }
  }
  return { width, height, data };
}

export function processRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  p: ToneParams,
): Bitmap1 {
  return ditherGray(applyTone(rgbaToGray(rgba, width, height), p), width, height, p);
}

export function blackRatio(b: Bitmap1): number {
  const n = b.data.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += b.data[i];
  return sum / n;
}
