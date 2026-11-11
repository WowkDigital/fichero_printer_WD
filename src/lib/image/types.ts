/** 1-bit bitmap, one byte per pixel: 1 = black (heater on), 0 = white. */
export interface Bitmap1 {
  width: number;
  height: number;
  data: Uint8Array;
}

export type DitherMode =
  | 'threshold'
  | 'floyd-steinberg'
  | 'atkinson'
  | 'jarvis'
  | 'stucki'
  | 'burkes'
  | 'sierra'
  | 'sierra-lite'
  | 'bayer2'
  | 'bayer4'
  | 'bayer8'
  | 'halftone'
  | 'random';

export interface ToneParams {
  brightness: number; // -100..100, 0 = neutral
  contrast: number; // -100..100, 0 = neutral
  gamma: number; // 0.1..3, 1 = neutral
  invert: boolean;
  dither: DitherMode;
  threshold: number; // 0..255, used by 'threshold' and as bias for error diffusion (128 = neutral)
  serpentine: boolean; // alternate scan direction for error-diffusion modes
  halftoneCell: number; // cell size in dots for 'halftone' (4..16)
  sharpen: number; // 0..300 %, unsharp mask strength applied before tone mapping (images and text)
}

export const DEFAULT_TONE: ToneParams = {
  brightness: 0,
  contrast: 0,
  gamma: 1,
  invert: false,
  dither: 'floyd-steinberg',
  threshold: 128,
  serpentine: true,
  halftoneCell: 6,
  sharpen: 0,
};

export const DITHER_MODES: { id: DitherMode; label: string }[] = [
  { id: 'threshold', label: 'Threshold' },
  { id: 'floyd-steinberg', label: 'Floyd-Steinberg' },
  { id: 'atkinson', label: 'Atkinson' },
  { id: 'jarvis', label: 'Jarvis-Judice-Ninke' },
  { id: 'stucki', label: 'Stucki' },
  { id: 'burkes', label: 'Burkes' },
  { id: 'sierra', label: 'Sierra' },
  { id: 'sierra-lite', label: 'Sierra Lite' },
  { id: 'bayer2', label: 'Bayer 2x2 (ordered)' },
  { id: 'bayer4', label: 'Bayer 4x4 (ordered)' },
  { id: 'bayer8', label: 'Bayer 8x8 (ordered)' },
  { id: 'halftone', label: 'Halftone (45 deg dots)' },
  { id: 'random', label: 'Random noise' },
];

/** Modes that diffuse quantisation error to neighbours (serpentine scan applies to these). */
export const DIFFUSION_MODES: DitherMode[] = ['floyd-steinberg', 'atkinson', 'jarvis', 'stucki', 'burkes', 'sierra', 'sierra-lite'];
