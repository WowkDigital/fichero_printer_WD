/** Timed and batch print experiments, built on top of app.run(). */
import { app, estimateSeconds } from '../app.svelte';
import type { JobOptions } from '../core/printer';
import { DOTS_PER_MM } from '../core/protocol';
import { blankBitmap, cropRows, stackBitmaps } from '../image/compose';
import { generatePattern } from '../image/patterns';
import { labelBitmap, measureText, textBitmap } from '../image/source';
import type { Bitmap1 } from '../image/types';
import { SWEEP_KINDS, type SweepConfig, type TickerConfig, type Variant } from './config';
import { fillCounter, formatDate, parseNumberList, splitLines } from './format';

/** Sleep until `until` (performance.now based) or the signal aborts. */
function sleepUntil(until: number, signal: AbortSignal): Promise<void> {
  const ms = until - performance.now();
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

const snapshot = <T>(value: T): T => $state.snapshot(value) as T;

/** Number of ticks a ticker config will print. */
export function tickerCount(cfg: TickerConfig): number {
  if (cfg.source === 'lines') return splitLines(cfg.lines).length;
  if (cfg.source === 'counter') return Math.max(0, Math.round(cfg.count));
  return Math.max(1, Math.floor((cfg.durationSec * 1000) / Math.max(50, cfg.intervalMs)));
}

function tickerText(cfg: TickerConfig, index: number, lines: string[]): string {
  if (cfg.source === 'lines') return lines[index] ?? '';
  if (cfg.source === 'counter') return fillCounter(cfg.counterTemplate, index);
  return formatDate(cfg.clockFormat, new Date());
}

/** Width in dots of the raster frames a ticker sends: the head, or the text rounded up to bytes. */
function tickerWidth(cfg: TickerConfig, sample: string): number {
  const head = app.settings.raster.headDots;
  if (!cfg.narrow) return head;
  const w = measureText({ ...cfg.text, text: sample });
  return Math.min(head, Math.max(8, Math.ceil(w / 8) * 8));
}

/** Rows and bytes of one tick, for the timing warning in the UI. */
export function tickerTickEstimate(cfg: TickerConfig): { rows: number; bytes: number; seconds: number } {
  const sample = tickerText(cfg, 0, splitLines(cfg.lines)) || 'X';
  const width = tickerWidth(cfg, sample);
  const rows = Math.round(cfg.text.size * cfg.text.lineHeight) + cfg.text.padding * 2 + cfg.gapRows;
  const bytes = rows * (width / 8) + 8;
  const job = app.settings.job;
  const seconds = estimateSeconds(bytes, cfg.mode === 'jobs' ? job : { ...job, finishPauseMs: 0 });
  return { rows, bytes, seconds };
}

/**
 * Print a line of text every `intervalMs`: the current date and time, the lines of a text,
 * or a counter. In stream mode it is one job with one raster frame per tick.
 */
export function runTicker() {
  const cfg = snapshot(app.settings.lab.ticker);
  const label = cfg.source === 'clock' ? 'Clock ticker' : cfg.source === 'lines' ? 'Line ticker' : 'Counter ticker';
  return app.run(label, async (printer, signal) => {
    const job = snapshot(app.settings.job);
    const lines = splitLines(cfg.lines);
    const count = tickerCount(cfg);
    if (count === 0) throw new Error('Nothing to print: the ticker has no lines.');
    const interval = Math.max(50, cfg.intervalMs);
    let sentBytes = 0;
    let paperRows = 0;
    let printed = 0;
    let late = 0;
    let acked: boolean | null = null;

    const frame = (bmp: Bitmap1, tailRows: number, headDots: number) =>
      app.buildPayload(bmp, { headDots, align: cfg.narrow ? 'left' : app.settings.raster.align, leadRows: 0, tailRows, bandRows: 0 });

    if (cfg.mode === 'stream') await printer.beginStream(job);
    try {
      const t0 = performance.now();
      for (let i = 0; i < count && !signal.aborted; i++) {
        const due = t0 + i * interval;
        if (performance.now() > due + interval / 2) late++;
        await sleepUntil(due, signal);
        if (signal.aborted) break;
        const text = tickerText(cfg, i, lines);
        const width = tickerWidth(cfg, text);
        const bmp = textBitmap({ ...cfg.text, text }, width);
        app.jobDetail = `${i + 1} / ${count} · ${text}`;
        const isLast = i === count - 1;
        if (cfg.mode === 'stream') {
          const payload = frame(bmp, cfg.gapRows, width);
          sentBytes += await printer.streamData(payload, job, signal);
        } else {
          const payload = frame(bmp, cfg.gapRows + (isLast ? cfg.tailRows : 0), width);
          const result = await printer.print(payload, job, undefined, signal);
          sentBytes += result.sentBytes;
          if (result.acknowledged === false) acked = false;
          else if (acked === null) acked = result.acknowledged;
        }
        paperRows += bmp.height + cfg.gapRows;
        printed++;
      }
    } finally {
      if (cfg.mode === 'stream') {
        // Push the last line past the tear bar, then close the job.
        if (cfg.tailRows > 0 && !signal.aborted) {
          const tail = frame(blankBitmap(8, 0), cfg.tailRows, cfg.narrow ? 8 : app.settings.raster.headDots);
          sentBytes += await printer.streamData(tail, job).catch(() => 0);
        }
        acked = await printer.endStream(job).catch(() => false);
      }
    }
    if (!signal.aborted || cfg.mode === 'jobs') paperRows += cfg.tailRows;
    return {
      ok: acked !== false && late === 0,
      detail: `${printed} / ${count} ticks${late ? `, ${late} late (transfer slower than the interval)` : ''}${acked === false ? ', no ACK' : ''}`,
      sentBytes,
      paperRows,
    };
  });
}

export interface SweepRow {
  label: string;
  ok: boolean | null;
  durationMs: number;
  sentBytes: number;
}

/** Live result table of the last sweep. */
export const sweepResults = $state<{ rows: SweepRow[] }>({ rows: [] });

/** The content strip a sweep prints for each step. */
async function sweepContent(cfg: SweepConfig): Promise<Bitmap1> {
  const width = app.settings.raster.headDots;
  const rows = cfg.stripMm > 0 ? Math.round(cfg.stripMm * DOTS_PER_MM) : Infinity;
  if (cfg.content === 'ladder') {
    return generatePattern('gray-ladder', { width, height: Number.isFinite(rows) ? rows : 15 * DOTS_PER_MM, cell: 16, tone: snapshot(app.settings.tone) });
  }
  const bmp = app.bitmap;
  if (!bmp) throw new Error('Nothing to print yet: choose a source on the Print tab.');
  return cropRows(bmp, rows);
}

/** The steps of a sweep: a caption and the job options for each. */
export function sweepSteps(cfg: SweepConfig, job: JobOptions): { label: string; job: JobOptions }[] {
  if (cfg.kind === 'repeat') {
    return Array.from({ length: Math.max(0, Math.round(cfg.repeatCount)) }, (_, i) => ({ label: `Copy ${i + 1}`, job }));
  }
  const kind = SWEEP_KINDS.find((k) => k.id === cfg.kind)!;
  return parseNumberList(cfg.values).map((value) => {
    const step = { ...job };
    if (cfg.kind === 'density') Object.assign(step, { density: Math.round(value) & 0xff, sendDensity: true });
    if (cfg.kind === 'chunkDelayMs') step.chunkDelayMs = Math.max(0, value);
    if (cfg.kind === 'chunkSize') step.chunkSize = Math.min(244, Math.max(20, Math.round(value)));
    return { label: `${kind.label} ${value}${kind.unit ? ' ' + kind.unit : ''}`, job: step };
  });
}

/** Print the same strip once per value of a job parameter, as separate jobs, and record each result. */
export function runSweep() {
  const cfg = snapshot(app.settings.lab.sweep);
  return app.run(`${SWEEP_KINDS.find((k) => k.id === cfg.kind)?.label} sweep`, async (printer, signal) => {
    const steps = sweepSteps(cfg, snapshot(app.settings.job));
    if (steps.length === 0) throw new Error('The sweep has no values.');
    const content = await sweepContent(cfg);
    const width = app.settings.raster.headDots;
    sweepResults.rows = steps.map((s) => ({ label: s.label, ok: null, durationMs: 0, sentBytes: 0 }));
    let sentBytes = 0;
    let paperRows = 0;
    let failures = 0;
    for (let i = 0; i < steps.length && !signal.aborted; i++) {
      if (i > 0 && cfg.pauseMs > 0) await sleepUntil(performance.now() + cfg.pauseMs, signal);
      if (signal.aborted) break;
      const step = steps[i];
      app.jobDetail = `${i + 1} / ${steps.length} · ${step.label}`;
      const bmp = cfg.label ? stackBitmaps([labelBitmap(step.label, width), content], width, 4) : content;
      const result = await app.printBitmap(printer, bmp, step.job, signal);
      const ok = !result.cancelled && result.acknowledged !== false;
      if (!ok) failures++;
      sweepResults.rows[i] = { label: step.label, ok, durationMs: result.durationMs, sentBytes: result.sentBytes };
      sentBytes += result.sentBytes;
      paperRows += bmp.height + app.settings.raster.leadRows + app.settings.raster.tailRows;
    }
    return { ok: failures === 0, detail: `${steps.length} jobs${failures ? `, ${failures} without ACK` : ''}`, sentBytes, paperRows };
  });
}

/** Print gallery variants stacked on one strip, each with its caption. */
export function printContactSheet(items: { variant: Variant; bitmap: Bitmap1 }[]) {
  return app.run('Contact sheet', async (printer, signal) => {
    const width = app.settings.raster.headDots;
    const parts = items.flatMap((item) => [labelBitmap(item.variant.label, width), item.bitmap]);
    const sheet = stackBitmaps(parts, width, 8);
    const result = await app.printBitmap(printer, sheet, snapshot(app.settings.job), signal);
    return {
      ok: !result.cancelled && result.acknowledged !== false,
      detail: `${items.length} variants`,
      sentBytes: result.sentBytes,
      paperRows: sheet.height + app.settings.raster.leadRows + app.settings.raster.tailRows,
      cancelled: result.cancelled,
    };
  });
}
