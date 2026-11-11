/** Printer session: serialized command queue, telemetry, heartbeat and paced print jobs. Framework-free. */
import { sleep } from './bytes';
import { Cmd, STOP_ACK, decodeBattery, decodeModel, decodeStatus, describeTx, type PrinterStatus } from './protocol';
import type { Transport } from './transport';

export interface Packet {
  id: number;
  /** Milliseconds since the session clock started (performance.now based). */
  t: number;
  /** Wall-clock timestamp (Date.now). */
  wall: number;
  dir: 'tx' | 'rx';
  data: Uint8Array;
  /** Decoded meaning, when known. */
  note: string | null;
}

export interface JobOptions {
  /** Send the density command before the job. */
  sendDensity: boolean;
  density: number;
  /** Send the paper-mode command before the job. */
  sendPaperMode: boolean;
  paperMode: number;
  sendWakeup: boolean;
  sendEnable: boolean;
  /** Bytes per BLE write. */
  chunkSize: number;
  /** Pause between writes in milliseconds. */
  chunkDelayMs: number;
  /** Use write-with-response (slower, flow-controlled by the link layer). */
  writeWithResponse: boolean;
  /** Pause after the last raster chunk before the stop command. */
  finishPauseMs: number;
  sendStop: boolean;
  /** How long to wait for the 0xAA acknowledgement. */
  ackTimeoutMs: number;
}

export const DEFAULT_JOB: JobOptions = {
  sendDensity: true,
  density: 1,
  sendPaperMode: true,
  paperMode: 2,
  sendWakeup: true,
  sendEnable: true,
  chunkSize: 200,
  chunkDelayMs: 20,
  writeWithResponse: false,
  finishPauseMs: 500,
  sendStop: true,
  ackTimeoutMs: 5000,
};

export interface JobProgress {
  phase: 'setup' | 'data' | 'finish';
  sentBytes: number;
  totalBytes: number;
  elapsedMs: number;
}

export interface JobResult {
  sentBytes: number;
  totalBytes: number;
  durationMs: number;
  /** True when the printer confirmed with 0xAA; null when the stop command was not sent. */
  acknowledged: boolean | null;
  cancelled: boolean;
}

export interface PrinterEvents {
  packet?: (packet: Packet) => void;
  status?: (status: PrinterStatus) => void;
  battery?: (percent: number) => void;
  model?: (model: string) => void;
  disconnect?: () => void;
}

type Waiter = { accept: (data: Uint8Array) => boolean; resolve: (data: Uint8Array | null) => void };

export class Printer {
  events: PrinterEvents = {};
  private transport: Transport | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private waiter: Waiter | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private packetId = 0;
  private clockStart = performance.now();
  private printing = false;

  get connected(): boolean {
    return this.transport !== null;
  }
  get deviceName(): string {
    return this.transport?.name ?? '';
  }
  get transportKind(): Transport['kind'] | null {
    return this.transport?.kind ?? null;
  }
  get busy(): boolean {
    return this.printing;
  }

  async connect(transport: Transport): Promise<void> {
    if (this.transport) await this.disconnect();
    transport.onData = (data) => this.handleRx(data);
    transport.onDisconnect = () => this.handleDisconnect();
    await transport.connect();
    this.transport = transport;
    this.queue = Promise.resolve();
    await this.sendRaw(Cmd.wakeup());
    await this.refresh();
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    const transport = this.transport;
    if (transport) await transport.disconnect();
  }

  /** Query model, battery and status. */
  async refresh(): Promise<void> {
    await this.queryModel();
    await this.queryBattery();
    await this.queryStatus();
  }

  async queryModel(): Promise<string | null> {
    const rx = await this.request(Cmd.model());
    if (!rx) return null;
    const model = decodeModel(rx);
    this.events.model?.(model);
    return model;
  }

  async queryBattery(): Promise<number | null> {
    const rx = await this.request(Cmd.battery());
    const level = rx ? decodeBattery(rx) : null;
    if (level !== null) this.events.battery?.(level);
    return level;
  }

  async queryStatus(): Promise<PrinterStatus | null> {
    const rx = await this.request(Cmd.status());
    if (!rx || rx.length === 0) return null;
    const status = decodeStatus(rx[rx.length - 1]);
    this.events.status?.(status);
    return status;
  }

  /** Periodic status + battery poll. Skipped while a print job is running. */
  startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    if (intervalMs <= 0) return;
    this.heartbeat = setInterval(() => {
      if (!this.transport || this.printing) return;
      this.queryStatus()
        .then(() => this.queryBattery())
        .catch(() => {});
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** Send arbitrary bytes, split into chunks. Replies show up as unsolicited RX packets. */
  sendRaw(data: Uint8Array, chunkSize = 200, chunkDelayMs = 20): Promise<void> {
    return this.enqueue(async () => {
      for (let offset = 0; offset < data.length; offset += chunkSize) {
        if (offset > 0) await sleep(chunkDelayMs);
        await this.tx(data.subarray(offset, offset + chunkSize));
      }
    });
  }

  /** Send a command and resolve with the next notification, or null on timeout. */
  request(data: Uint8Array, timeoutMs = 1500): Promise<Uint8Array | null> {
    return this.enqueue(async () => {
      const reply = this.waitForRx(() => true, timeoutMs);
      await this.tx(data);
      return reply;
    });
  }

  /**
   * Run a full print job: setup commands, paced raster transfer, stop + acknowledgement.
   * `payload` is the prebuilt raster stream (see buildRaster).
   */
  print(payload: Uint8Array, opts: JobOptions, onProgress?: (p: JobProgress) => void, signal?: AbortSignal): Promise<JobResult> {
    return this.enqueue(async () => {
      this.printing = true;
      const started = performance.now();
      const elapsed = () => performance.now() - started;
      const chunk = Math.max(1, Math.round(opts.chunkSize));
      let sent = 0;
      let acknowledged: boolean | null = null;
      try {
        onProgress?.({ phase: 'setup', sentBytes: 0, totalBytes: payload.length, elapsedMs: 0 });
        if (opts.sendDensity) await this.tx(Cmd.density(opts.density));
        if (opts.sendPaperMode) await this.tx(Cmd.paperMode(opts.paperMode));
        if (opts.sendWakeup) await this.tx(Cmd.wakeup());
        if (opts.sendEnable) await this.tx(Cmd.enable());

        while (sent < payload.length && !signal?.aborted) {
          const part = payload.subarray(sent, sent + chunk);
          await this.tx(part, opts.writeWithResponse, sent === 0 ? null : `Raster data @${sent}`);
          sent += part.length;
          onProgress?.({ phase: 'data', sentBytes: sent, totalBytes: payload.length, elapsedMs: elapsed() });
          if (opts.chunkDelayMs > 0) await sleep(opts.chunkDelayMs);
        }

        onProgress?.({ phase: 'finish', sentBytes: sent, totalBytes: payload.length, elapsedMs: elapsed() });
        if (!signal?.aborted && opts.finishPauseMs > 0) await sleep(opts.finishPauseMs);
        if (opts.sendStop) {
          const ack = this.waitForRx((rx) => rx.includes(STOP_ACK), opts.ackTimeoutMs);
          await this.tx(Cmd.stop());
          acknowledged = (await ack) !== null;
        }
      } finally {
        this.printing = false;
      }
      return { sentBytes: sent, totalBytes: payload.length, durationMs: elapsed(), acknowledged, cancelled: !!signal?.aborted };
    });
  }

  // --- internals ---

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  private waitForRx(accept: Waiter['accept'], timeoutMs: number): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      const waiter: Waiter = {
        accept,
        resolve: (data) => {
          clearTimeout(timer);
          if (this.waiter === waiter) this.waiter = null;
          resolve(data);
        },
      };
      const timer = setTimeout(() => waiter.resolve(null), timeoutMs);
      this.waiter = waiter;
    });
  }

  private async tx(data: Uint8Array, withResponse = false, note: string | null = null): Promise<void> {
    const transport = this.transport;
    if (!transport) throw new Error('Printer is not connected');
    this.emitPacket('tx', data, note ?? describeTx(data));
    await transport.write(data, withResponse);
  }

  private handleRx(data: Uint8Array): void {
    this.emitPacket('rx', data, data.length === 1 && data[0] === STOP_ACK ? 'Print finished (ACK)' : null);
    const waiter = this.waiter;
    if (waiter && waiter.accept(data)) waiter.resolve(data);
  }

  private handleDisconnect(): void {
    this.stopHeartbeat();
    this.transport = null;
    this.waiter?.resolve(null);
    this.events.disconnect?.();
  }

  private emitPacket(dir: Packet['dir'], data: Uint8Array, note: string | null): void {
    this.events.packet?.({
      id: ++this.packetId,
      t: performance.now() - this.clockStart,
      wall: Date.now(),
      dir,
      data: data.slice(),
      note,
    });
  }
}
