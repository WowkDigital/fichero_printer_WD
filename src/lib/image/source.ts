/** Canvas-based rasterizers that turn user content into RGBA ready for dithering. Browser only. */
import type { DitherRequest, DitherResponse } from './worker';
import type { Bitmap1, ToneParams } from './types';

/** Hard cap on job height: 20000 rows = 2.5 m of paper. */
export const MAX_ROWS = 20000;

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ImageLayout {
  /** Target width in dots. */
  width: number;
  rotate: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
}

export interface TextParams {
  text: string;
  font: 'sans-serif' | 'serif' | 'monospace';
  /** Font size in dots (8 dots = 1 mm). */
  size: number;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  /** Padding around the text block in dots. */
  padding: number;
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

/** Scale (and optionally rotate) an image to `layout.width` dots, keeping the aspect ratio. */
export function rasterizeImage(img: ImageBitmap, layout: ImageLayout): Rgba {
  const swap = layout.rotate === 90 || layout.rotate === 270;
  const srcW = swap ? img.height : img.width;
  const srcH = swap ? img.width : img.height;
  const width = Math.max(1, Math.round(layout.width));
  const height = Math.max(1, Math.min(MAX_ROWS, Math.round((srcH / srcW) * width)));
  const { ctx } = makeCanvas(width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(width / 2, height / 2);
  ctx.scale(layout.flipH ? -1 : 1, layout.flipV ? -1 : 1);
  ctx.rotate((layout.rotate * Math.PI) / 180);
  const drawW = swap ? height : width;
  const drawH = swap ? width : height;
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  const data = ctx.getImageData(0, 0, width, height);
  return { data: data.data, width, height };
}

/** Render word-wrapped text onto a white canvas `width` dots wide. */
export function rasterizeText(p: TextParams, width: number): Rgba {
  const font = `${p.bold ? '700' : '400'} ${p.size}px ${p.font}`;
  const measure = makeCanvas(1, 1).ctx;
  measure.font = font;
  const maxLine = Math.max(1, width - p.padding * 2);
  const lines: string[] = [];
  for (const paragraph of p.text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure.measureText(candidate).width > maxLine) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  const step = Math.round(p.size * p.lineHeight);
  const height = Math.max(1, Math.min(MAX_ROWS, p.padding * 2 + lines.length * step));
  const { ctx } = makeCanvas(width, height);
  ctx.font = font;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';
  ctx.textAlign = p.align;
  const x = p.align === 'left' ? p.padding : p.align === 'right' ? width - p.padding : width / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, p.padding + i * step + step / 2));
  const data = ctx.getImageData(0, 0, width, height);
  return { data: data.data, width, height };
}

/** Width in dots of the widest line of `p.text` (without wrapping), plus padding on both sides. */
export function measureText(p: TextParams): number {
  const ctx = makeCanvas(1, 1).ctx;
  ctx.font = `${p.bold ? '700' : '400'} ${p.size}px ${p.font}`;
  const widest = Math.max(0, ...p.text.split('\n').map((line) => ctx.measureText(line).width));
  return Math.ceil(widest + p.padding * 2);
}

/** Render text straight to 1-bit with a plain threshold, on the main thread. Fast enough for labels and ticker lines. */
export function textBitmap(p: TextParams, width: number): Bitmap1 {
  const rgba = rasterizeText(p, width);
  const n = rgba.width * rgba.height;
  const data = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (0.299 * rgba.data[j] + 0.587 * rgba.data[j + 1] + 0.114 * rgba.data[j + 2] < 128) data[i] = 1;
  }
  return { width: rgba.width, height: rgba.height, data };
}

/** A one-line caption strip, e.g. for contact sheets and sweeps. */
export function labelBitmap(text: string, width: number, size = 32): Bitmap1 {
  return textBitmap({ text, font: 'monospace', size, bold: true, align: 'left', lineHeight: 1.2, padding: 8 }, width);
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (bmp: Bitmap1) => void>();

/** Dither RGBA in the background worker. The RGBA buffer is transferred and must not be reused. */
export function ditherInWorker(rgba: Rgba, tone: ToneParams): Promise<Bitmap1> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<DitherResponse>) => {
      const { id, width, height, data } = event.data;
      pending.get(id)?.({ width, height, data: new Uint8Array(data) });
      pending.delete(id);
    };
  }
  const id = ++nextId;
  const buffer = rgba.data.buffer as ArrayBuffer;
  const request: DitherRequest = { id, rgba: buffer, width: rgba.width, height: rgba.height, tone };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage(request, [buffer]);
  });
}
