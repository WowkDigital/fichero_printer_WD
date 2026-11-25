import { rgbaToGray } from './dither';
import { rasterizeImage } from './source';
import { DEFAULT_TONE, type ToneParams } from './types';

export const STATIC_TONE_PRESETS = [
  { label: 'Balanced photo', tone: { dither: 'floyd-steinberg', gamma: 1.1, sharpen: 35 } },
  { label: 'Text and line art', tone: { dither: 'threshold', threshold: 150, contrast: 30, sharpen: 60 } },
  { label: 'Light print', tone: { dither: 'atkinson', brightness: 12, gamma: 1.25, threshold: 115 } },
  { label: 'Halftone dots', tone: { dither: 'halftone', halftoneCell: 8, contrast: 10 } },
] satisfies { label: string; tone: Partial<ToneParams> }[];

export const AUTO_TONE_PRESETS = [
  { id: 'photo', label: 'Auto photo' },
  { id: 'document', label: 'Auto document' },
  { id: 'light', label: 'Auto light print' },
] as const;

export function autoTone(image: ImageBitmap, preset: (typeof AUTO_TONE_PRESETS)[number]['id']): ToneParams {
  const width = Math.min(image.width, (192 * image.width) / Math.max(image.width, image.height));
  const sample = rasterizeImage(image, { width, rotate: 0 });
  const gray = rgbaToGray(sample.data, sample.width, sample.height);
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[Math.round(value)]++;

  function percentile(fraction: number): number {
    const target = Math.ceil(gray.length * fraction);
    let count = 0;
    for (let i = 0; i < histogram.length; i++) {
      count += histogram[i];
      if (count >= target) return i;
    }
    return 255;
  }

  const low = percentile(0.05);
  const mid = percentile(0.5);
  const high = percentile(0.95);
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  if (preset === 'document') {
    const threshold = high - low < 16 ? 128 : clamp(Math.round((low + high) / 2), 25, 230);
    return { ...DEFAULT_TONE, dither: 'threshold', threshold, sharpen: 50 };
  }

  const contrast = clamp(Math.round((200 - (high - low)) / 4), -10, 35);
  if (preset === 'light') {
    const brightness = clamp(Math.round((175 - mid) / 5), 5, 30);
    return { ...DEFAULT_TONE, dither: 'atkinson', brightness, contrast, gamma: 1.2, threshold: 115, sharpen: 35 };
  }

  const brightness = clamp(Math.round((135 - mid) / 6), -15, 25);
  return { ...DEFAULT_TONE, brightness, contrast, sharpen: 35 };
}
