import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concatBytes, toHex } from './bytes';
import { DEFAULT_JOB, Printer, type JobOptions, type JobProgress, type Packet } from './printer';
import { Cmd } from './protocol';
import { MockTransport, type Transport } from './transport';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Transport that connects and accepts writes but never answers. */
class SilentTransport implements Transport {
  readonly kind = 'mock' as const;
  name = 'silent';
  onData: (data: Uint8Array) => void = () => {};
  onDisconnect: () => void = () => {};
  writes: Uint8Array[] = [];
  async connect() {}
  async disconnect() {
    this.onDisconnect();
  }
  async write(data: Uint8Array) {
    this.writes.push(data.slice());
  }
}

const FAST: JobOptions = { ...DEFAULT_JOB, chunkSize: 10, chunkDelayMs: 1, finishPauseMs: 1, ackTimeoutMs: 1000 };

function payloadOf(n: number): Uint8Array {
  // Starts with a byte that describeTx does not recognise.
  return Uint8Array.from({ length: n }, (_, i) => (i + 0x55) & 0xff);
}

async function connectMock() {
  const printer = new Printer();
  const transport = new MockTransport();
  const packets: Packet[] = [];
  printer.events.packet = (p) => packets.push(p);
  const p = printer.connect(transport);
  await vi.runAllTimersAsync();
  await p;
  packets.length = 0;
  return { printer, transport, packets };
}

describe('Printer.connect', () => {
  it('sends wakeup then queries and fires model/battery/status events', async () => {
    const printer = new Printer();
    const transport = new MockTransport();
    const packets: Packet[] = [];
    const model = vi.fn();
    const battery = vi.fn();
    const status = vi.fn();
    printer.events = { packet: (p) => packets.push(p), model, battery, status };

    expect(printer.connected).toBe(false);
    const p = printer.connect(transport);
    await vi.runAllTimersAsync();
    await p;

    expect(printer.connected).toBe(true);
    expect(printer.deviceName).toBe(transport.name);
    expect(printer.transportKind).toBe('mock');
    expect(model).toHaveBeenCalledWith('FICHERO_6181');
    expect(battery).toHaveBeenCalledWith(87);
    expect(status).toHaveBeenCalledTimes(1);
    expect(status.mock.calls[0][0]).toMatchObject({ raw: 0, printing: false, coverOpen: false, noPaper: false });

    expect(packets.map((x) => `${x.dir}:${x.note}`)).toEqual([
      'tx:Wakeup',
      'tx:Query model',
      'rx:null',
      'tx:Query battery',
      'rx:null',
      'tx:Query status',
      'rx:null',
    ]);
    expect(toHex(packets[0].data)).toBe(toHex(Cmd.wakeup()));
    expect(packets.map((x) => x.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('disconnect() fires the disconnect event and connected becomes false', async () => {
    const { printer } = await connectMock();
    const onDisc = vi.fn();
    printer.events.disconnect = onDisc;
    await printer.disconnect();
    expect(onDisc).toHaveBeenCalledTimes(1);
    expect(printer.connected).toBe(false);
    expect(printer.deviceName).toBe('');
    expect(printer.transportKind).toBeNull();
  });
});

describe('Printer.request', () => {
  it('resolves null on timeout when nothing answers', async () => {
    const printer = new Printer();
    const transport = new SilentTransport();
    const cp = printer.connect(transport);
    await vi.advanceTimersByTimeAsync(10_000); // wakeup + 3 timed-out queries
    await cp;

    let result: Uint8Array | null | undefined;
    const rp = printer.request(Cmd.model(), 100).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(99);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await rp;
    expect(result).toBeNull();
  });

  it('queries return null and fire no events when unanswered', async () => {
    const printer = new Printer();
    const transport = new SilentTransport();
    const cp = printer.connect(transport);
    await vi.advanceTimersByTimeAsync(10_000);
    await cp;
    const battery = vi.fn();
    printer.events.battery = battery;
    const q = printer.queryBattery();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await q).toBeNull();
    expect(battery).not.toHaveBeenCalled();
  });

  it('resolves with the reply bytes from the mock', async () => {
    const { printer } = await connectMock();
    const rp = printer.request(Cmd.battery());
    await vi.runAllTimersAsync();
    expect(Array.from((await rp)!)).toEqual([0x00, 87]);
  });
});

describe('Printer.sendRaw', () => {
  it('splits into chunks of the requested size', async () => {
    const { printer, transport } = await connectMock();
    const spy = vi.spyOn(transport, 'write');
    const data = payloadOf(25);
    const p = printer.sendRaw(data, 10, 1);
    await vi.runAllTimersAsync();
    await p;
    const sizes = spy.mock.calls.map((c) => c[0].length);
    expect(sizes).toEqual([10, 10, 5]);
    expect(Array.from(concatBytes(spy.mock.calls.map((c) => c[0])))).toEqual(Array.from(data));
  });

  it('emits tx packets with decoded notes', async () => {
    const { printer, packets } = await connectMock();
    const p = printer.sendRaw(Cmd.formFeed());
    await vi.runAllTimersAsync();
    await p;
    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({ dir: 'tx', note: 'Form feed' });
  });

  it('rejects when not connected', async () => {
    const printer = new Printer();
    await expect(printer.sendRaw(Uint8Array.of(1))).rejects.toThrow(/not connected/i);
  });
});

describe('Printer.print', () => {
  it('sends setup in order, chunked payload, then stop; acknowledged = true', async () => {
    const { printer, transport, packets } = await connectMock();
    const spy = vi.spyOn(transport, 'write');
    const payload = payloadOf(35);
    const p = printer.print(payload, FAST);
    await vi.runAllTimersAsync();
    const result = await p;

    const writes = spy.mock.calls.map((c) => c[0]);
    expect(Array.from(writes[0])).toEqual(Array.from(Cmd.density(1)));
    expect(Array.from(writes[1])).toEqual(Array.from(Cmd.paperMode(2)));
    expect(Array.from(writes[2])).toEqual(Array.from(Cmd.wakeup()));
    expect(Array.from(writes[3])).toEqual(Array.from(Cmd.enable()));
    const data = writes.slice(4, -1);
    expect(data.map((d) => d.length)).toEqual([10, 10, 10, 5]);
    expect(Array.from(concatBytes(data))).toEqual(Array.from(payload));
    expect(Array.from(writes[writes.length - 1])).toEqual(Array.from(Cmd.stop()));

    expect(result.sentBytes).toBe(35);
    expect(result.totalBytes).toBe(35);
    expect(result.acknowledged).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(transport.rasterBytes).toBe(0); // payload is not a valid GS v 0 stream
    expect(printer.busy).toBe(false);

    const notes = packets.map((x) => `${x.dir}:${x.note}`);
    expect(notes).toEqual([
      'tx:Set density 1',
      'tx:Set paper mode 2',
      'tx:Wakeup',
      'tx:Enable printer',
      'tx:null',
      'tx:Raster data @10',
      'tx:Raster data @20',
      'tx:Raster data @30',
      'tx:Stop print',
      'rx:Print finished (ACK)',
    ]);
  });

  it('writes with response when requested', async () => {
    const { printer, transport } = await connectMock();
    const spy = vi.spyOn(transport, 'write');
    const p = printer.print(payloadOf(5), { ...FAST, writeWithResponse: true });
    await vi.runAllTimersAsync();
    await p;
    // data chunk is the 5th write
    expect(spy.mock.calls[4][1]).toBe(true);
  });

  it('omits setup and stop commands when the send* options are false', async () => {
    const { printer, transport } = await connectMock();
    const spy = vi.spyOn(transport, 'write');
    const payload = payloadOf(25);
    const p = printer.print(payload, {
      ...FAST,
      sendDensity: false,
      sendPaperMode: false,
      sendWakeup: false,
      sendEnable: false,
      sendStop: false,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    const writes = spy.mock.calls.map((c) => c[0]);
    expect(writes.map((w) => w.length)).toEqual([10, 10, 5]);
    expect(Array.from(concatBytes(writes))).toEqual(Array.from(payload));
    expect(result.acknowledged).toBeNull();
  });

  it('each send* flag controls only its own command', async () => {
    const flags = {
      sendDensity: Cmd.density(1),
      sendPaperMode: Cmd.paperMode(2),
      sendWakeup: Cmd.wakeup(),
      sendEnable: Cmd.enable(),
      sendStop: Cmd.stop(),
    } as const;
    for (const [flag, cmd] of Object.entries(flags)) {
      const { printer, transport } = await connectMock();
      const spy = vi.spyOn(transport, 'write');
      const p = printer.print(payloadOf(5), { ...FAST, [flag]: false });
      await vi.runAllTimersAsync();
      await p;
      const hexes = spy.mock.calls.map((c) => toHex(c[0]));
      expect(hexes).not.toContain(toHex(cmd));
      expect(hexes).toHaveLength(5); // 4 of 5 optional commands + 1 data chunk
    }
  });

  it('reports acknowledged = false when no ACK arrives', async () => {
    const printer = new Printer();
    const transport = new SilentTransport();
    const cp = printer.connect(transport);
    await vi.advanceTimersByTimeAsync(10_000);
    await cp;
    const p = printer.print(payloadOf(5), { ...FAST, ackTimeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await p;
    expect(result.acknowledged).toBe(false);
  });

  it('abort mid-job stops data transfer early and returns cancelled = true', async () => {
    const { printer, transport } = await connectMock();
    const spy = vi.spyOn(transport, 'write');
    const ctrl = new AbortController();
    const payload = payloadOf(100);
    const p = printer.print(payload, FAST, (pr) => {
      if (pr.phase === 'data' && pr.sentBytes >= 30) ctrl.abort();
    }, ctrl.signal);
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.cancelled).toBe(true);
    expect(result.sentBytes).toBe(30);
    expect(result.sentBytes).toBeLessThan(result.totalBytes);
    // 4 setup writes + 3 data chunks + stop; the remaining 70 payload bytes were never written
    expect(spy.mock.calls).toHaveLength(4 + 3 + 1);
    expect(printer.busy).toBe(false);
  });

  it('an already aborted signal sends no payload', async () => {
    const { printer } = await connectMock();
    const ctrl = new AbortController();
    ctrl.abort();
    const p = printer.print(payloadOf(50), FAST, undefined, ctrl.signal);
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.cancelled).toBe(true);
    expect(result.sentBytes).toBe(0);
  });

  it('progress is monotonic and ends at totalBytes', async () => {
    const { printer } = await connectMock();
    const seen: JobProgress[] = [];
    const payload = payloadOf(47);
    const p = printer.print(payload, FAST, (pr) => seen.push({ ...pr }));
    await vi.runAllTimersAsync();
    await p;
    expect(seen[0]).toMatchObject({ phase: 'setup', sentBytes: 0, totalBytes: 47 });
    expect(seen[seen.length - 1]).toMatchObject({ phase: 'finish', sentBytes: 47, totalBytes: 47 });
    for (let i = 1; i < seen.length; i++) expect(seen[i].sentBytes).toBeGreaterThanOrEqual(seen[i - 1].sentBytes);
    const dataSteps = seen.filter((s) => s.phase === 'data').map((s) => s.sentBytes);
    expect(dataSteps).toEqual([10, 20, 30, 40, 47]);
    for (let i = 1; i < dataSteps.length; i++) expect(dataSteps[i]).toBeGreaterThan(dataSteps[i - 1]);
  });

  it('a valid raster stream is fully consumed by the mock', async () => {
    const { printer, transport } = await connectMock();
    const header = Cmd.rasterHeader(2, 20); // 40 payload bytes
    const payload = concatBytes([header, new Uint8Array(40).fill(0xff)]);
    const p = printer.print(payload, FAST);
    await vi.runAllTimersAsync();
    await p;
    expect(transport.rasterBytes).toBe(40);
  });
});

describe('Printer streaming job', () => {
  it('sends setup once, every frame, then stop, and reports the ACK', async () => {
    const { printer, transport, packets } = await connectMock();
    const begin = printer.beginStream(FAST);
    await vi.runAllTimersAsync();
    await begin;
    expect(printer.busy).toBe(true);

    for (const n of [25, 7]) {
      const sent = printer.streamData(payloadOf(n), FAST);
      await vi.runAllTimersAsync();
      expect(await sent).toBe(n);
    }
    const end = printer.endStream(FAST);
    await vi.runAllTimersAsync();
    expect(await end).toBe(true);
    expect(printer.busy).toBe(false);

    const tx = packets.filter((p) => p.dir === 'tx');
    expect(tx.filter((p) => p.note === 'Enable printer')).toHaveLength(1);
    expect(tx.filter((p) => p.note === 'Stop print')).toHaveLength(1);
    expect(tx.at(-1)?.note).toBe('Stop print');
    expect(transport.rasterBytes).toBe(0);
  });

  it('stops sending data when aborted', async () => {
    const { printer } = await connectMock();
    const controller = new AbortController();
    controller.abort();
    const sent = printer.streamData(payloadOf(50), FAST, controller.signal);
    await vi.runAllTimersAsync();
    expect(await sent).toBe(0);
  });
});
