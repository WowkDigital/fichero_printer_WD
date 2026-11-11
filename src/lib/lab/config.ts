/** Settings shapes and defaults for the gallery and the experiments. Framework-free. */
import { DITHER_MODES, type ToneParams } from '../image/types';
import type { TextParams } from '../image/source';

/**
 * Where a job goes.
 * - print: the real printer, as rendered.
 * - blank: the real printer, but every raster row is white. Paper moves the same distance,
 *   the job takes the same time and the motor sounds the same, yet nothing is burned.
 * - simulate: nothing is sent to the printer; a simulated one receives the job with the same pacing.
 */
export type OutputMode = 'print' | 'blank' | 'simulate';

export const OUTPUT_MODES: { id: OutputMode; label: string; short: string; hint: string }[] = [
  { id: 'print', label: 'Print', short: 'Print', hint: 'Send the job to the printer as rendered.' },
  { id: 'blank', label: 'Blank run', short: 'Blank', hint: 'Real printer, all-white rows: same paper, time and motor sound, nothing burned.' },
  { id: 'simulate', label: 'Simulate', short: 'Sim', hint:'Nothing leaves the browser. Measures time and paper with the current pacing.' },
];

export type TickerSource = 'clock' | 'lines' | 'counter';

export interface TickerConfig {
  source: TickerSource;
  /** Tokens: YYYY YY MM DD HH mm ss SSS. */
  clockFormat: string;
  durationSec: number;
  lines: string;
  /** `{n}` = 1-based tick, `{i}` = 0-based. */
  counterTemplate: string;
  count: number;
  intervalMs: number;
  /** stream = one job, one raster frame per tick; jobs = a full job (setup + stop) per tick. */
  mode: 'stream' | 'jobs';
  text: Omit<TextParams, 'text'>;
  /** Blank rows after each tick. */
  gapRows: number;
  /** Blank rows at the end of the run, to clear the tear bar. */
  tailRows: number;
  /** Send raster frames only as wide as the text instead of the full head. Untested on hardware. */
  narrow: boolean;
}

export type SweepKind = 'density' | 'chunkDelayMs' | 'chunkSize' | 'repeat';

export interface SweepConfig {
  kind: SweepKind;
  values: string;
  repeatCount: number;
  pauseMs: number;
  content: 'current' | 'ladder';
  /** Print a caption with the swept value above each strip. */
  label: boolean;
  /** Crop each strip to this height; 0 keeps the full content. */
  stripMm: number;
}

export type GallerySweep = 'algorithm' | 'threshold' | 'gamma' | 'brightness' | 'contrast' | 'halftone';

export interface GalleryConfig {
  sweep: GallerySweep;
  /** CSS pixels per dot; 0 = fit to card. */
  zoom: number;
  /** Only the first rows are rendered, to keep the gallery fast. */
  maxMm: number;
}

export interface LabSettings {
  ticker: TickerConfig;
  sweep: SweepConfig;
  gallery: GalleryConfig;
}

export function defaultLab(): LabSettings {
  return {
    ticker: {
      source: 'clock',
      clockFormat: 'DD:MM:YYYY HH:mm:ss',
      durationSec: 10,
      lines: 'First line\nSecond line\nThird line',
      counterTemplate: 'Tick #{n}',
      count: 10,
      intervalMs: 1000,
      mode: 'stream',
      text: { font: 'monospace', size: 48, bold: true, align: 'left', lineHeight: 1.15, padding: 8 },
      gapRows: 0,
      tailRows: 160,
      narrow: false,
    },
    sweep: {
      kind: 'density',
      values: '0, 1, 2',
      repeatCount: 3,
      pauseMs: 1000,
      content: 'ladder',
      label: true,
      stripMm: 15,
    },
    gallery: { sweep: 'algorithm', zoom: 0, maxMm: 60 },
  };
}

export const SWEEP_KINDS: { id: SweepKind; label: string; unit: string; hint: string; defaults: string }[] = [
  { id: 'density', label: 'Density', unit: '', hint: 'One job per density value. 0-2 are documented; others are passed through raw.', defaults: '0, 1, 2' },
  { id: 'chunkDelayMs', label: 'Chunk delay', unit: 'ms', hint: 'Find the fastest pacing that still prints every line.', defaults: '40, 20, 10, 5, 0' },
  { id: 'chunkSize', label: 'Chunk size', unit: 'B', hint: 'Bytes per BLE write, 20-244.', defaults: '244, 200, 128, 64' },
  { id: 'repeat', label: 'Repeat', unit: '', hint: 'The same job several times with a pause in between.', defaults: '' },
];

export const GALLERY_SWEEPS: { id: GallerySweep; label: string }[] = [
  { id: 'algorithm', label: 'Algorithms' },
  { id: 'threshold', label: 'Threshold' },
  { id: 'gamma', label: 'Gamma' },
  { id: 'brightness', label: 'Brightness' },
  { id: 'contrast', label: 'Contrast' },
  { id: 'halftone', label: 'Halftone cell' },
];

export interface Variant {
  label: string;
  tone: ToneParams;
}

/** The tone variants a gallery sweep compares, each derived from the current tone. */
export function galleryVariants(sweep: GallerySweep, base: ToneParams): Variant[] {
  const v = (label: string, patch: Partial<ToneParams>): Variant => ({ label, tone: { ...base, ...patch } });
  switch (sweep) {
    case 'algorithm':
      return DITHER_MODES.map((m) => v(m.label, { dither: m.id }));
    case 'threshold':
      return [64, 96, 112, 128, 144, 160, 192].map((t) => v(`Threshold ${t}`, { threshold: t }));
    case 'gamma':
      return [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5].map((g) => v(`Gamma ${g}`, { gamma: g }));
    case 'brightness':
      return [-60, -30, -15, 0, 15, 30, 60].map((b) => v(`Brightness ${b}`, { brightness: b }));
    case 'contrast':
      return [-60, -30, -15, 0, 15, 30, 60].map((c) => v(`Contrast ${c}`, { contrast: c }));
    case 'halftone':
      return [4, 5, 6, 8, 10, 12, 16].map((c) => v(`Halftone ${c} dots`, { dither: 'halftone', halftoneCell: c }));
  }
}
