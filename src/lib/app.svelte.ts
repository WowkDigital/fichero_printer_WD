/** Reactive application state: bridges the framework-free core to the Svelte UI. */
import { concatBytes, parseHex, toAscii, toHex } from './core/bytes';
import { DEFAULT_JOB, Printer, type JobOptions, type JobProgress, type JobResult, type Packet } from './core/printer';
import { Cmd, DOTS_PER_MM, HEAD_STANDARD, TEAR_BAR_ROWS, type PrinterStatus } from './core/protocol';
import { buildRaster, type RasterOptions } from './core/raster';
import { MockTransport, WebBluetoothTransport, isBluetoothSupported } from './core/transport';
import { generatePattern, type PatternId } from './image/patterns';
import { ditherInWorker, rasterizeImage, rasterizeText, type TextParams } from './image/source';
import { DEFAULT_TONE, type Bitmap1, type ToneParams } from './image/types';

export type Tab = 'device' | 'print' | 'packets';
export type SourceType = 'image' | 'text' | 'pattern';

export interface Settings {
  job: JobOptions;
  raster: RasterOptions;
  tone: ToneParams;
  heartbeatSec: number;
  showAllDevices: boolean;
  /** Keep raster data chunks in the packet log (thousands of entries per page). */
  logRasterData: boolean;
  source: {
    type: SourceType;
    image: { fit: 'head' | 'scale'; scalePct: number; rotate: 0 | 90 | 180 | 270 };
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
    heartbeatSec: 15,
    showAllDevices: false,
    logRasterData: true,
    source: {
      type: 'pattern',
      image: { fit: 'head', scalePct: 100, rotate: 0 },
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
  jobProgress = $state<JobProgress | null>(null);
  jobResult = $state<JobResult | null>(null);
  private abort: AbortController | null = null;

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
      // ESC J takes at most 255 rows per command.
      let rows = Math.round(mm * DOTS_PER_MM);
      const parts: Uint8Array[] = [];
      while (rows > 0) {
        parts.push(Cmd.feed(Math.min(255, rows)));
        rows -= 255;
      }
      for (const part of parts) await this.printer.sendRaw(part);
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
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => void this.render(), 120);
  }

  private async render() {
    const token = ++this.renderToken;
    const { source, raster } = this.settings;
    const tone = $state.snapshot(this.settings.tone);
    this.rendering = true;
    try {
      let bmp: Bitmap1 | null = null;
      if (source.type === 'pattern') {
        bmp = generatePattern(source.pattern.id, {
          width: raster.headDots,
          height: Math.max(8, Math.round(source.pattern.heightMm * DOTS_PER_MM)),
          cell: Math.max(1, Math.round(source.pattern.cell)),
          tone,
        });
      } else if (source.type === 'text') {
        bmp = await ditherInWorker(rasterizeText($state.snapshot(source.text), raster.headDots), tone);
      } else if (this.image) {
        const width = source.image.fit === 'head' ? raster.headDots : (this.image.width * source.image.scalePct) / 100;
        bmp = await ditherInWorker(rasterizeImage(this.image, { width, rotate: source.image.rotate }), tone);
      }
      if (token === this.renderToken) this.bitmap = bmp;
    } catch (err) {
      if (token === this.renderToken) this.error = describeError(err);
    } finally {
      if (token === this.renderToken) this.rendering = false;
    }
  }

  // --- print job ---

  /** Size of the byte stream the current job would send. */
  get payloadBytes(): number {
    const bmp = this.bitmap;
    if (!bmp) return 0;
    const { raster } = this.settings;
    const rows = bmp.height + raster.leadRows + raster.tailRows;
    const frames = raster.bandRows > 0 ? Math.ceil(rows / raster.bandRows) : Math.ceil(rows / 0xffff);
    return rows * (raster.headDots / 8) + Math.max(1, frames) * 8;
  }

  /** Lower bound for the transfer time given chunk size and pacing. */
  get estimatedSeconds(): number {
    const { job } = this.settings;
    const chunks = Math.ceil(this.payloadBytes / Math.max(1, job.chunkSize));
    return (chunks * job.chunkDelayMs + job.finishPauseMs) / 1000;
  }

  async print() {
    const bmp = this.bitmap;
    if (!bmp || !this.connected || this.jobRunning) return;
    this.error = null;
    this.jobResult = null;
    this.jobRunning = true;
    this.abort = new AbortController();
    let wakeLock: WakeLockSentinel | null = null;
    try {
      // Keep the screen on: a backgrounded mobile tab throttles timers and stalls the transfer.
      wakeLock = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null;
      const payload = buildRaster(bmp, $state.snapshot(this.settings.raster));
      this.jobResult = await this.printer.print(
        payload,
        $state.snapshot(this.settings.job),
        (progress) => (this.jobProgress = progress),
        this.abort.signal,
      );
      await this.printer.queryStatus();
    } catch (err) {
      this.error = describeError(err);
    } finally {
      this.jobRunning = false;
      this.jobProgress = null;
      this.abort = null;
      await wakeLock?.release().catch(() => {});
    }
  }

  cancelPrint() {
    this.abort?.abort();
  }
}

function describeError(err: unknown): string {
  const e = err as { name?: string; message?: string };
  if (e?.name === 'SecurityError') return 'Bluetooth access was blocked. Open the app over HTTPS and allow Bluetooth.';
  if (e?.name === 'NetworkError') return 'Connection to the printer failed or was lost. Check that it is on and in range.';
  return e?.message || String(err);
}

export const app = new AppState();
