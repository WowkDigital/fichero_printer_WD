/** Reactive application state: bridges the framework-free core to the Svelte UI. */
import { concatBytes, parseHex, toAscii, toHex } from './core/bytes';
import { DEFAULT_JOB, Printer, type JobOptions, type JobProgress, type JobResult, type Packet } from './core/printer';
import { Cmd, DOTS_PER_MM, HEAD_STANDARD, TEAR_BAR_ROWS, type PrinterStatus } from './core/protocol';
import { buildRaster, type RasterOptions } from './core/raster';
import { MockTransport, WebBluetoothTransport, isBluetoothSupported } from './core/transport';
import { blankBitmap } from './image/compose';
import { generatePattern, type PatternId } from './image/patterns';
import { ditherInWorker, rasterizeImage, rasterizeText, type Rgba, type TextParams } from './image/source';
import { DEFAULT_TONE, type Bitmap1, type ToneParams } from './image/types';
import { defaultLab, type LabSettings, type OutputMode } from './lab/config';

export type Tab = 'device' | 'print' | 'gallery' | 'lab' | 'packets';
export type SourceType = 'image' | 'text' | 'pattern';

export interface Settings {
  job: JobOptions;
  raster: RasterOptions;
  tone: ToneParams;
  output: OutputMode;
  lab: LabSettings;
  heartbeatSec: number;
  showAllDevices: boolean;
  /** Keep raster data chunks in the packet log (thousands of entries per page). */
  logRasterData: boolean;
  source: {
    type: SourceType;
    image: { fit: 'head' | 'scale'; scalePct: number; printScalePct: number; rotate: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean };
    text: TextParams;
    pattern: { id: PatternId; heightMm: number; cell: number };
  };
}

const STORAGE_KEY = 'fichero-lab-settings-v1';
const MAX_PACKETS = 5000;

export function defaultSettings(): Settings {
  return {
    job: { ...DEFAULT_JOB },
    raster: { headDots: HEAD_STANDARD, align: 'center', offsetDots: 0, leadRows: 0, tailRows: TEAR_BAR_ROWS, bandRows: 0 },
    tone: { ...DEFAULT_TONE },
    output: 'print',
    lab: defaultLab(),
    heartbeatSec: 15,
    showAllDevices: false,
    logRasterData: true,
    source: {
      type: 'pattern',
      image: { fit: 'head', scalePct: 100, printScalePct: 100, rotate: 0, flipH: false, flipV: false },
      text: {
        text: 'Fichero 6181\nThermal print test',
        font: 'sans-serif',
        size: 96,
        bold: true,
        align: 'center',
        lineHeight: 1.25,
        padding: 40,
      },
      pattern: { id: 'gray-ladder', heightMm: 60, cell: 16 },
    },
  };
}

/** Overlay saved values on defaults so new settings keys survive upgrades. */
function merge<T>(base: T, saved: unknown): T {
  if (typeof base !== 'object' || base === null || typeof saved !== 'object' || saved === null) {
    return typeof saved === typeof base ? (saved as T) : base;
  }
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (key in (saved as object)) out[key] = merge(out[key], (saved as Record<string, unknown>)[key]);
  }
  return out as T;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return merge(defaultSettings(), JSON.parse(raw));
  } catch {
    // Storage unavailable or corrupted: fall back to defaults.
  }
  return defaultSettings();
}

class AppState {
  readonly printer = new Printer();
  readonly bluetoothSupported = isBluetoothSupported();

  settings = $state<Settings>(loadSettings());
  tab = $state<Tab>('device');

  conn = $state<'disconnected' | 'connecting' | 'connected'>('disconnected');
  deviceName = $state('');
  kind = $state<'ble' | 'mock' | null>(null);
  model = $state('');
  battery = $state<number | null>(null);
  status = $state<PrinterStatus | null>(null);
  statusAt = $state(0);
  error = $state<string | null>(null);

  /** Packet log lives outside the reactive graph; `packetTick` signals changes at most once per frame. */
  packets: Packet[] = [];
  packetTick = $state(0);
  txBytes = $state(0);
  rxBytes = $state(0);
  private tickQueued = false;

  image = $state.raw<ImageBitmap | null>(null);
  imageName = $state('');
  bitmap = $state.raw<Bitmap1 | null>(null);
  rendering = $state(false);
  private renderToken = 0;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;

  jobRunning = $state(false);
  /** What is running, e.g. "Print" or "Clock ticker". */
  jobLabel = $state('');
  /** Free-form progress line for multi-step jobs ("tick 3 / 10"). */
  jobDetail = $state('');
  jobProgress = $state<JobProgress | null>(null);
  jobResult = $state<JobResult | null>(null);
  /** Summary of the last finished job, shown under the header. */
  lastRun = $state<RunSummary | null>(null);
  private abort: AbortController | null = null;
  private simPrinter: Printer | null = null;

  constructor() {
    const p = this.printer;
    p.events.packet = (packet) => this.addPacket(packet);
    p.events.model = (model) => (this.model = model);
    p.events.battery = (level) => (this.battery = level);
    p.events.status = (status) => {
      this.status = status;
      this.statusAt = Date.now();
    };
    p.events.disconnect = () => {
      this.conn = 'disconnected';
      this.kind = null;
      this.status = null;
      this.battery = null;
    };
    // Low-level access from the DevTools console.
    Object.assign(globalThis, { printer: p, fichero: { Cmd, parseHex, toHex, toAscii, concatBytes, buildRaster, app: this } });
  }

  get connected() {
    return this.conn === 'connected';
  }

  saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore: settings just will not persist.
    }
  }

  resetSettings() {
    this.settings = defaultSettings();
    this.setHeartbeat(this.settings.heartbeatSec);
    this.rendering = true;
    this.scheduleRender();
  }

  // --- connection ---

  async connect(demo = false) {
    if (this.conn !== 'disconnected') return;
    this.error = null;
    this.conn = 'connecting';
    try {
      const transport = demo ? new MockTransport() : new WebBluetoothTransport({ showAllDevices: this.settings.showAllDevices });
      await this.printer.connect(transport);
      this.deviceName = this.printer.deviceName;
      this.kind = this.printer.transportKind;
      this.conn = 'connected';
      this.printer.startHeartbeat(this.settings.heartbeatSec * 1000);
    } catch (err) {
      this.conn = 'disconnected';
      // NotFoundError = the user closed the device chooser; not worth an error banner.
      if ((err as Error)?.name !== 'NotFoundError') this.error = describeError(err);
    }
  }

  async disconnect() {
    await this.guard(() => this.printer.disconnect());
  }

  setHeartbeat(seconds: number) {
    this.settings.heartbeatSec = seconds;
    if (this.connected) this.printer.startHeartbeat(seconds * 1000);
  }

  /** Run a printer action and surface failures in the error banner. */
  async guard(action: () => Promise<unknown>) {
    try {
      this.error = null;
      await action();
    } catch (err) {
      this.error = describeError(err);
    }
  }

  refresh = () => this.guard(() => this.printer.refresh());
  feed = (mm: number) =>
    this.guard(async () => {
      const rows = Math.round(mm * DOTS_PER_MM);
      const result = await this.printer.print(new Uint8Array(), $state.snapshot(this.settings.job), undefined, undefined, rows);
      if (result.acknowledged === false) throw new Error('Feed sent, but the printer did not acknowledge the job.');
    });
  send = (data: Uint8Array) => this.guard(() => this.printer.sendRaw(data, this.settings.job.chunkSize, this.settings.job.chunkDelayMs));

  // --- packet log ---

  private addPacket(packet: Packet) {
    if (packet.dir === 'tx') this.txBytes += packet.data.length;
    else this.rxBytes += packet.data.length;
    const isRasterData = packet.dir === 'tx' && packet.note?.startsWith('Raster data');
    if (isRasterData && !this.settings.logRasterData) return;
    this.packets.push(packet);
    if (this.packets.length > MAX_PACKETS) this.packets.splice(0, this.packets.length - MAX_PACKETS);
    if (!this.tickQueued) {
      this.tickQueued = true;
      requestAnimationFrame(() => {
        this.tickQueued = false;
        this.packetTick++;
      });
    }
  }

  clearPackets() {
    this.packets = [];
    this.txBytes = 0;
    this.rxBytes = 0;
    this.packetTick++;
  }

  // --- print source rendering ---

  async loadImage(file: File) {
    try {
      this.error = null;
      this.image = await createImageBitmap(file);
      this.imageName = file.name;
      this.settings.source.type = 'image';
    } catch {
      this.error = `Could not decode "${file.name}" as an image`;
    }
  }

  /** Debounced re-render of the 1-bit preview from the current source and tone settings. */
  scheduleRender() {
    this.rendering = true;
    const token = ++this.renderToken;
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => void this.render(token), 120);
  }

  /**
   * Render the current source with the given tone. `maxRows` crops the source before dithering
   * (the gallery uses it to keep many variants fast).
   */
  async renderSource(tone: ToneParams, maxRows = Infinity): Promise<Bitmap1 | null> {
    const { source, raster } = this.settings;
    const limit = Math.max(1, Math.round(maxRows));
    const crop = (rgba: Rgba): Rgba =>
      rgba.height <= limit ? rgba : { width: rgba.width, height: limit, data: rgba.data.slice(0, limit * rgba.width * 4) };
    if (source.type === 'pattern') {
      const height = Math.max(8, Math.round(source.pattern.heightMm * DOTS_PER_MM));
      return generatePattern(source.pattern.id, {
        width: raster.headDots,
        height: Math.min(height, limit),
        cell: Math.max(1, Math.round(source.pattern.cell)),
        tone,
      });
    }
    if (source.type === 'text') return ditherInWorker(crop(rasterizeText($state.snapshot(source.text), raster.headDots)), tone);
    if (this.image) {
      const { fit, scalePct, printScalePct, rotate, flipH, flipV } = source.image;
      const baseWidth = fit === 'head' ? raster.headDots : (this.image.width * scalePct) / 100;
      const width = printScalePct < 100 ? (Math.min(baseWidth, raster.headDots) * printScalePct) / 100 : baseWidth;
      return ditherInWorker(crop(rasterizeImage(this.image, { width, rotate, flipH, flipV })), tone);
    }
    return null;
  }

  private async render(token: number) {
    const tone = $state.snapshot(this.settings.tone);
    this.rendering = true;
    try {
      const bmp = await this.renderSource(tone);
      if (token === this.renderToken) this.bitmap = bmp;
    } catch (err) {
      if (token === this.renderToken) this.error = describeError(err);
    } finally {
      if (token === this.renderToken) this.rendering = false;
    }
  }

  // --- print job ---

  /** Total paper rows (content plus blank lead/tail rows) of the current job. */
  get paperRows(): number {
    const bmp = this.bitmap;
    if (!bmp) return 0;
    const { raster } = this.settings;
    return bmp.height + raster.leadRows + raster.tailRows;
  }

  /** Size of the byte stream the current job would send. */
  get payloadBytes(): number {
    if (!this.bitmap) return 0;
    const { raster } = this.settings;
    const rows = this.bitmap.height + raster.leadRows;
    const frames = raster.bandRows > 0 ? Math.ceil(rows / raster.bandRows) : Math.ceil(rows / 0xffff);
    return rows * (raster.headDots / 8) + Math.max(1, frames) * 8;
  }

  /** Lower bound for the transfer time given chunk size and pacing. */
  get estimatedSeconds(): number {
    return estimateSeconds(this.payloadBytes, this.settings.job);
  }

  /** True when a job can start with the current output mode. */
  get canRun(): boolean {
    return !this.jobRunning && (this.settings.output === 'simulate' || this.connected);
  }

  /** The bitmap actually sent for `bmp` in the current output mode: an all-white copy in blank mode. */
  outputBitmap(bmp: Bitmap1): Bitmap1 {
    return this.settings.output === 'blank' ? blankBitmap(bmp.width, bmp.height) : bmp;
  }

  /** Build the raster stream for `bmp` with the current layout (plus `patch`), honouring the output mode. */
  buildPayload(bmp: Bitmap1, patch: Partial<RasterOptions> = {}): Uint8Array {
    return buildRaster(this.outputBitmap(bmp), { ...$state.snapshot(this.settings.raster), ...patch });
  }

  printBitmap(printer: Printer, bmp: Bitmap1, job: JobOptions, signal: AbortSignal) {
    const feedRows = Math.max(0, Math.round(this.settings.raster.tailRows));
    return printer.print(this.buildPayload(bmp, { tailRows: 0 }), job, (progress) => (this.jobProgress = progress), signal, feedRows);
  }

  /** The printer jobs go to: the real one, or a private simulated one in simulate mode. */
  private async target(): Promise<Printer> {
    if (this.settings.output !== 'simulate') {
      if (!this.connected) throw new Error('Connect a printer first, or switch the output to Simulate.');
      return this.printer;
    }
    if (!this.simPrinter) {
      const sim = new Printer();
      await sim.connect(new MockTransport());
      // Log the simulated traffic too, marked, so the stream can still be inspected.
      sim.events.packet = (packet) => this.addPacket({ ...packet, id: packet.id + 1e9, note: `[sim] ${packet.note ?? ''}`.trim() });
      this.simPrinter = sim;
    }
    return this.simPrinter;
  }

  /**
   * Run one job or experiment exclusively: one at a time, with a wake lock, the error banner,
   * cancel support and a summary afterwards.
   */
  async run(label: string, task: (printer: Printer, signal: AbortSignal) => Promise<RunOutcome>) {
    if (this.jobRunning) return;
    this.error = null;
    this.jobResult = null;
    this.lastRun = null;
    this.jobLabel = label;
    this.jobDetail = '';
    this.jobRunning = true;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const mode = this.settings.output;
    const started = performance.now();
    let wakeLock: WakeLockSentinel | null = null;
    try {
      // Keep the screen on: a backgrounded mobile tab throttles timers and stalls the transfer.
      wakeLock = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null;
      const printer = await this.target();
      const outcome = await task(printer, signal);
      this.lastRun = {
        label,
        mode,
        durationMs: performance.now() - started,
        ...outcome,
        cancelled: outcome.cancelled ?? signal.aborted,
      };
      if (printer === this.printer) await this.printer.queryStatus();
    } catch (err) {
      this.error = describeError(err);
    } finally {
      this.jobRunning = false;
      this.jobProgress = null;
      this.jobDetail = '';
      this.abort = null;
      await wakeLock?.release().catch(() => {});
    }
  }

  async print() {
    const bmp = this.bitmap;
    if (!bmp || !this.canRun) return;
    const paperRows = this.paperRows;
    await this.run('Print', async (printer, signal) => {
      const result = await this.printBitmap(printer, bmp, $state.snapshot(this.settings.job), signal);
      this.jobResult = result;
      return {
        ok: !result.cancelled && result.acknowledged !== false,
        detail: result.acknowledged === false ? 'Sent, no ACK from printer' : result.acknowledged ? 'ACK received' : 'Sent',
        sentBytes: result.sentBytes,
        paperRows: result.cancelled && result.totalBytes > 0
          ? Math.round(((paperRows - this.settings.raster.tailRows) * result.sentBytes) / result.totalBytes)
          : paperRows,
        cancelled: result.cancelled,
      };
    });
  }

  cancelPrint() {
    this.abort?.abort();
  }
}

export interface RunOutcome {
  ok: boolean;
  detail: string;
  sentBytes: number;
  /** Paper used, in dot rows (8 rows = 1 mm). */
  paperRows: number;
  cancelled?: boolean;
}

export interface RunSummary extends RunOutcome {
  label: string;
  mode: OutputMode;
  durationMs: number;
  cancelled: boolean;
}

/** Lower bound for the transfer time of `bytes` with the given pacing. */
export function estimateSeconds(bytes: number, job: JobOptions): number {
  const chunks = Math.ceil(bytes / Math.max(1, job.chunkSize));
  return (chunks * job.chunkDelayMs + job.finishPauseMs) / 1000;
}

function describeError(err: unknown): string {
  const e = err as { name?: string; message?: string };
  if (e?.name === 'SecurityError') return 'Bluetooth access was blocked. Open the app over HTTPS and allow Bluetooth.';
  if (e?.name === 'NetworkError') return 'Connection to the printer failed or was lost. Check that it is on and in range.';
  return e?.message || String(err);
}

export const app = new AppState();
