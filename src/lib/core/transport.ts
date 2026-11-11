/** Byte transports: real Web Bluetooth and a simulated printer for demo/testing. */
import { sleep, startsWith } from './bytes';
import { AUX_SERVICE_UUID, NAME_PREFIXES, NOTIFY_UUID, SERVICE_UUID, STOP_ACK, WRITE_UUID } from './protocol';

export interface Transport {
  readonly kind: 'ble' | 'mock';
  /** Device name, available after connect(). */
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: Uint8Array, withResponse?: boolean): Promise<void>;
  /** Assigned by the owner before connect(). */
  onData: (data: Uint8Array) => void;
  onDisconnect: () => void;
}

export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export interface BleOptions {
  /** Show every nearby BLE device in the chooser instead of filtering by name prefix. */
  showAllDevices?: boolean;
}

export class WebBluetoothTransport implements Transport {
  readonly kind = 'ble' as const;
  name = '';
  onData: (data: Uint8Array) => void = () => {};
  onDisconnect: () => void = () => {};

  private device: BluetoothDevice | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;

  constructor(private options: BleOptions = {}) {}

  private handleValue = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (value) this.onData(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
  };

  private handleDisconnect = () => {
    this.cleanup();
    this.onDisconnect();
  };

  /** Must be called from a user gesture (click / tap). */
  async connect(): Promise<void> {
    if (!isBluetoothSupported()) throw new Error('Web Bluetooth is not available in this browser');
    const optionalServices = [SERVICE_UUID, AUX_SERVICE_UUID];
    const device = await navigator.bluetooth.requestDevice(
      this.options.showAllDevices
        ? { acceptAllDevices: true, optionalServices }
        : { filters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })), optionalServices },
    );
    this.device = device;
    this.name = device.name ?? 'Unknown device';
    device.addEventListener('gattserverdisconnected', this.handleDisconnect);
    try {
      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      this.writeChar = await service.getCharacteristic(WRITE_UUID);
      this.notifyChar = await service.getCharacteristic(NOTIFY_UUID);
      await this.notifyChar.startNotifications();
      this.notifyChar.addEventListener('characteristicvaluechanged', this.handleValue);
    } catch (err) {
      device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
      if (device.gatt?.connected) device.gatt.disconnect();
      this.cleanup();
      throw err;
    }
  }

  async write(data: Uint8Array, withResponse = false): Promise<void> {
    if (!this.writeChar) throw new Error('Not connected');
    // Copy into a fresh ArrayBuffer: subarray views may sit on a larger shared buffer.
    const buf = data.slice().buffer as ArrayBuffer;
    if (withResponse) await this.writeChar.writeValueWithResponse(buf);
    else await this.writeChar.writeValueWithoutResponse(buf);
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    if (device?.gatt?.connected) device.gatt.disconnect(); // fires gattserverdisconnected -> handleDisconnect
    else if (device) this.handleDisconnect();
  }

  private cleanup() {
    this.notifyChar?.removeEventListener('characteristicvaluechanged', this.handleValue);
    this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnect);
    this.writeChar = null;
    this.notifyChar = null;
    this.device = null;
  }
}

/**
 * Simulated printer. Answers the telemetry queries, swallows raster data and
 * acknowledges the stop command, so the whole app can be exercised without hardware.
 */
export class MockTransport implements Transport {
  readonly kind = 'mock' as const;
  name = 'FICHERO_6181_BLE (simulated)';
  onData: (data: Uint8Array) => void = () => {};
  onDisconnect: () => void = () => {};

  /** Total raster payload bytes received since connect (for tests). */
  rasterBytes = 0;
  private connected = false;
  private rasterRemaining = 0;
  private battery = 87;

  async connect(): Promise<void> {
    await sleep(250);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.onDisconnect();
  }

  async write(data: Uint8Array, _withResponse = false): Promise<void> {
    if (!this.connected) throw new Error('Not connected');
    let view = data;
    if (this.rasterRemaining > 0) {
      const used = Math.min(this.rasterRemaining, view.length);
      this.rasterRemaining -= used;
      this.rasterBytes += used;
      view = view.subarray(used);
      if (view.length === 0) return;
    }
    if (startsWith(view, [0x1d, 0x76, 0x30]) && view.length >= 8) {
      const total = (view[4] | (view[5] << 8)) * (view[6] | (view[7] << 8));
      const used = Math.min(total, view.length - 8);
      this.rasterBytes += used;
      this.rasterRemaining = total - used;
      return;
    }
    if (startsWith(view, [0x10, 0xff, 0x20, 0xf0])) this.reply(new TextEncoder().encode('FICHERO_6181'));
    else if (startsWith(view, [0x10, 0xff, 0x50, 0xf1])) this.reply(Uint8Array.of(0x00, this.battery));
    else if (startsWith(view, [0x10, 0xff, 0x40])) this.reply(Uint8Array.of(this.rasterRemaining > 0 ? 0x01 : 0x00));
    else if (startsWith(view, [0x10, 0xff, 0xfe, 0x45])) this.reply(Uint8Array.of(STOP_ACK), 120);
  }

  private reply(data: Uint8Array, delay = 25) {
    setTimeout(() => {
      if (this.connected) this.onData(data);
    }, delay);
  }
}
