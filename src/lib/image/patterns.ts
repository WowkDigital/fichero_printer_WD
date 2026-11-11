import type { Bitmap1, ToneParams } from './types';
import { ditherGray } from './dither';

export type PatternId =
  | 'checker'
  | 'v-stripes'
  | 'h-stripes'
  | 'grid'
  | 'gray-ladder'
  | 'gradient'
  | 'ruler'
  | 'solid-bars'
  | 'fine-lines'
  | 'border';

export interface PatternParams {
  width: number;
  height: number;
  cell: number;
  tone: ToneParams;
}

export const PATTERNS: { id: PatternId; label: string; description: string }[] = [
  { id: 'checker', label: 'Checkerboard', description: 'Alternating black and white squares of the chosen cell size.' },
  { id: 'v-stripes', label: 'Vertical stripes', description: 'Alternating vertical bars; tests per-dot column uniformity.' },
  { id: 'h-stripes', label: 'Horizontal stripes', description: 'Alternating horizontal bars; tests feed accuracy and banding.' },
  { id: 'grid', label: 'Grid', description: 'One-dot lines every cell dots in both directions.' },
  { id: 'gray-ladder', label: 'Gray ladder', description: 'Eleven bands from 0% to 100% black, dithered with the current mode.' },
  { id: 'gradient', label: 'Gradient', description: 'Smooth horizontal black to white gradient, dithered.' },
  { id: 'ruler', label: 'Ruler', description: 'Full-width ruler: ticks every 1 mm (8 dots), longer at 5 mm and 10 mm.' },
  { id: 'solid-bars', label: 'Solid bars', description: 'Solid black bars 1, 2, 4, 8, 16, 32 dots thick; tests heat and density.' },
  { id: 'fine-lines', label: 'Fine lines', description: 'Vertical line pairs spaced 1, 2, 3, 4 dots apart in four columns.' },
  { id: 'border', label: 'Border and diagonals', description: '2-dot outline plus both diagonals; checks head width and clipping.' },
];

function setPx(b: Bitmap1, x: number, y: number): void {
  if (x >= 0 && x < b.width && y >= 0 && y < b.height) b.data[y * b.width + x] = 1;
}

export function generatePattern(id: PatternId, p: PatternParams): Bitmap1 {
  const w = Math.max(0, Math.floor(p.width));
  const h = Math.max(0, Math.floor(p.height));
  const cell = Math.max(1, Math.floor(p.cell));
  const b: Bitmap1 = { width: w, height: h, data: new Uint8Array(w * h) };
  const d = b.data;

  switch (id) {
    case 'checker':
      for (let y = 0; y < h; y++) {
        const cy = Math.floor(y / cell);
        for (let x = 0; x < w; x++) {
          if (((Math.floor(x / cell) + cy) & 1) === 0) d[y * w + x] = 1;
        }
      }
      break;
    case 'v-stripes':
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) if ((Math.floor(x / cell) & 1) === 0) d[y * w + x] = 1;
      }
      break;
    case 'h-stripes':
      for (let y = 0; y < h; y++) {
        if ((Math.floor(y / cell) & 1) === 0) d.fill(1, y * w, y * w + w);
      }
      break;
    case 'grid':
      for (let y = 0; y < h; y++) {
        if (y % cell === 0) d.fill(1, y * w, y * w + w);
        else for (let x = 0; x < w; x += cell) d[y * w + x] = 1;
      }
      break;
    case 'gray-ladder': {
      const g = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        const band = Math.min(10, Math.floor((y * 11) / h));
        g.fill(255 * (1 - band / 10), y * w, y * w + w);
      }
      return ditherGray(g, w, h, p.tone);
    }
    case 'gradient': {
      const g = new Float32Array(w * h);
      for (let x = 0; x < w; x++) g[x] = w > 1 ? (255 * x) / (w - 1) : 0;
      for (let y = 1; y < h; y++) g.copyWithin(y * w, 0, w);
      return ditherGray(g, w, h, p.tone);
    }
    case 'ruler': {
      if (h === 0) break;
      d.fill(1, 0, w); // baseline on the first row
      const lenMm = Math.max(2, Math.round(h * 0.3));
      const len5 = Math.max(3, Math.round(h * 0.5));
      const len10 = Math.max(4, Math.round(h * 0.8));
      for (let mm = 0, x = 0; x < w; mm++, x = mm * 8) {
        const len = mm % 10 === 0 ? len10 : mm % 5 === 0 ? len5 : lenMm;
        for (let y = 0; y < Math.min(len, h); y++) d[y * w + x] = 1;
      }
      break;
    }
    case 'solid-bars': {
      const sizes = [1, 2, 4, 8, 16, 32];
      const gap = 8;
      let y = 0;
      while (y < h) {
        for (const t of sizes) {
          for (let r = 0; r < t && y + r < h; r++) d.fill(1, (y + r) * w, (y + r) * w + w);
          y += t + gap;
          if (y >= h) break;
        }
      }
      break;
    }
    case 'fine-lines': {
      const colW = Math.floor(w / 4);
      for (let x = 0; x < w; x++) {
        const col = colW > 0 ? Math.min(3, Math.floor(x / colW)) : 0;
        const s = col + 1; // white dots between the two lines of a pair
        const period = s + 2 + 8;
        const pos = (x - col * colW) % period;
        if (pos === 0 || pos === s + 1) {
          for (let y = 0; y < h; y++) d[y * w + x] = 1;
        }
      }
      break;
    }
    case 'border': {
      for (let y = 0; y < h; y++) {
        if (y < 2 || y >= h - 2) d.fill(1, y * w, y * w + w);
        else {
          setPx(b, 0, y);
          setPx(b, 1, y);
          setPx(b, w - 1, y);
          setPx(b, w - 2, y);
        }
        const x = h > 1 ? Math.round((y * (w - 1)) / (h - 1)) : 0;
        setPx(b, x, y);
        setPx(b, x + 1, y);
        setPx(b, w - 1 - x, y);
        setPx(b, w - 2 - x, y);
      }
      break;
    }
  }
  return b;
}
