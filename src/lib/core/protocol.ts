/** Fichero 6181 / AiYin BLE protocol: identifiers, command builders, response decoders. */
import { startsWith } from './bytes';

export const SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
export const AUX_SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';
export const WRITE_UUID = '00002af1-0000-1000-8000-00805f9b34fb';
export const NOTIFY_UUID = '00002af0-0000-1000-8000-00805f9b34fb';

export const NAME_PREFIXES = ['FICHERO', 'D11s_', 'PeriPage'];

export const DPI = 203;
export const DOTS_PER_MM = 8;
/** Printable head widths in dots. */
export const HEAD_STANDARD = 1632;
export const HEAD_FULL = 1680;
/** Distance from the heater line to the tear bar, in dot rows (20 mm). */
export const TEAR_BAR_ROWS = 160;
/** Maximum rows a single GS v 0 frame can declare (16-bit height). */
export const MAX_FRAME_ROWS = 0xffff;

export const STOP_ACK = 0xaa;

export const Cmd = {
  wakeup: () => new Uint8Array(12),
  model: () => Uint8Array.of(0x10, 0xff, 0x20, 0xf0),
  battery: () => Uint8Array.of(0x10, 0xff, 0x50, 0xf1),
  status: () => Uint8Array.of(0x10, 0xff, 0x40),
  /** 0 = light, 1 = normal, 2 = high. Other values are passed through for experiments. */
  density: (level: number) => Uint8Array.of(0x10, 0xff, 0x10, 0x00, level & 0xff),
  /** 2 = continuous roll. */
  paperMode: (mode: number) => Uint8Array.of(0x10, 0xff, 0x84, mode & 0xff),
  enable: () => Uint8Array.of(0x10, 0xff, 0xfe, 0x01),
  stop: () => Uint8Array.of(0x10, 0xff, 0xfe, 0x45),
  /** ESC J n - feed n dot rows (0..255). */
  feed: (rows: number) => Uint8Array.of(0x1b, 0x4a, Math.max(0, Math.min(255, Math.round(rows)))),
  /** GS FF - advance to the next page mark. */
  formFeed: () => Uint8Array.of(0x1d, 0x0c),
  /** GS v 0 header for a raster frame of `bytesPerRow` x `rows`. */
  rasterHeader: (bytesPerRow: number, rows: number) =>
    Uint8Array.of(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff),
};

export interface PrinterStatus {
  raw: number;
  printing: boolean;
  coverOpen: boolean;
  noPaper: boolean;
  overheated: boolean;
  charging: boolean;
}

export function decodeStatus(raw: number): PrinterStatus {
  return {
    raw,
    printing: (raw & 0x01) !== 0,
    coverOpen: (raw & 0x02) !== 0,
    noPaper: (raw & 0x04) !== 0,
    overheated: (raw & 0x50) !== 0,
    charging: (raw & 0x20) !== 0,
  };
}

/** Battery reply: the last byte is the charge level in percent. */
export function decodeBattery(data: Uint8Array): number | null {
  if (data.length === 0) return null;
  const level = data[data.length - 1];
  return level <= 100 ? level : null;
}

export function decodeModel(data: Uint8Array): string {
  let out = '';
  for (const b of data) if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
  return out.trim();
}

/** Human-readable name of a known outgoing command, or null for unknown bytes. */
export function describeTx(data: Uint8Array): string | null {
  if (data.length === 12 && data.every((b) => b === 0)) return 'Wakeup';
  if (startsWith(data, [0x10, 0xff, 0x20, 0xf0])) return 'Query model';
  if (startsWith(data, [0x10, 0xff, 0x50, 0xf1])) return 'Query battery';
  if (startsWith(data, [0x10, 0xff, 0x40])) return 'Query status';
  if (startsWith(data, [0x10, 0xff, 0x10, 0x00]) && data.length >= 5) return `Set density ${data[4]}`;
  if (startsWith(data, [0x10, 0xff, 0x84]) && data.length >= 4) return `Set paper mode ${data[3]}`;
  if (startsWith(data, [0x10, 0xff, 0xfe, 0x01])) return 'Enable printer';
  if (startsWith(data, [0x10, 0xff, 0xfe, 0x45])) return 'Stop print';
  if (startsWith(data, [0x1b, 0x4a]) && data.length >= 3) return `Feed ${data[2]} rows (${(data[2] / DOTS_PER_MM).toFixed(1)} mm)`;
  if (startsWith(data, [0x1d, 0x0c])) return 'Form feed';
  if (startsWith(data, [0x1d, 0x76, 0x30]) && data.length >= 8) {
    const w = data[4] | (data[5] << 8);
    const h = data[6] | (data[7] << 8);
    return `Raster header ${w * 8}x${h}`;
  }
  return null;
}
