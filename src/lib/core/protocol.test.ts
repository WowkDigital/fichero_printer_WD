import { describe, expect, it } from 'vitest';
import { Cmd, decodeBattery, decodeModel, decodeStatus, describeTx } from './protocol';

const arr = (u: Uint8Array) => Array.from(u);

describe('Cmd builders', () => {
  it('wakeup is 12 zero bytes', () => {
    expect(arr(Cmd.wakeup())).toEqual(new Array(12).fill(0));
  });
  it('query commands', () => {
    expect(arr(Cmd.model())).toEqual([0x10, 0xff, 0x20, 0xf0]);
    expect(arr(Cmd.battery())).toEqual([0x10, 0xff, 0x50, 0xf1]);
    expect(arr(Cmd.status())).toEqual([0x10, 0xff, 0x40]);
  });
  it('density', () => {
    expect(arr(Cmd.density(0))).toEqual([0x10, 0xff, 0x10, 0x00, 0x00]);
    expect(arr(Cmd.density(2))).toEqual([0x10, 0xff, 0x10, 0x00, 0x02]);
  });
  it('paperMode', () => {
    expect(arr(Cmd.paperMode(2))).toEqual([0x10, 0xff, 0x84, 0x02]);
  });
  it('enable and stop', () => {
    expect(arr(Cmd.enable())).toEqual([0x10, 0xff, 0xfe, 0x01]);
    expect(arr(Cmd.stop())).toEqual([0x10, 0xff, 0xfe, 0x45]);
  });
  it('feed, clamped to 0..255', () => {
    expect(arr(Cmd.feed(80))).toEqual([0x1b, 0x4a, 0x50]);
    expect(arr(Cmd.feed(-5))).toEqual([0x1b, 0x4a, 0]);
    expect(arr(Cmd.feed(1000))).toEqual([0x1b, 0x4a, 255]);
    expect(arr(Cmd.feed(10.6))).toEqual([0x1b, 0x4a, 11]);
  });
  it('formFeed', () => {
    expect(arr(Cmd.formFeed())).toEqual([0x1d, 0x0c]);
  });
  it('rasterHeader is little-endian', () => {
    expect(arr(Cmd.rasterHeader(204, 300))).toEqual([0x1d, 0x76, 0x30, 0x00, 0xcc, 0x00, 0x2c, 0x01]);
  });
});

describe('decodeStatus', () => {
  it('idle', () => {
    expect(decodeStatus(0)).toEqual({ raw: 0, printing: false, coverOpen: false, noPaper: false, overheated: false, charging: false });
  });
  it.each([
    [0x01, 'printing'],
    [0x02, 'coverOpen'],
    [0x04, 'noPaper'],
    [0x10, 'overheated'],
    [0x40, 'overheated'],
    [0x20, 'charging'],
  ] as const)('bit %i sets only %s', (raw, key) => {
    const s = decodeStatus(raw);
    expect(s.raw).toBe(raw);
    for (const k of ['printing', 'coverOpen', 'noPaper', 'overheated', 'charging'] as const) {
      expect(s[k]).toBe(k === key);
    }
  });
  it('combines bits', () => {
    const s = decodeStatus(0x07);
    expect(s.printing && s.coverOpen && s.noPaper).toBe(true);
    expect(s.charging).toBe(false);
  });
});

describe('decodeBattery', () => {
  it('uses the last byte', () => {
    expect(decodeBattery(Uint8Array.of(0x00, 0x64))).toBe(100);
    expect(decodeBattery(Uint8Array.of(0x00, 0x57))).toBe(87);
    expect(decodeBattery(Uint8Array.of(0))).toBe(0);
  });
  it('returns null for empty or out of range', () => {
    expect(decodeBattery(new Uint8Array(0))).toBeNull();
    expect(decodeBattery(Uint8Array.of(0x00, 101))).toBeNull();
    expect(decodeBattery(Uint8Array.of(0xff))).toBeNull();
  });
});

describe('decodeModel', () => {
  it('decodes printable ASCII', () => {
    expect(decodeModel(new TextEncoder().encode('FICHERO_6181'))).toBe('FICHERO_6181');
  });
  it('drops non-printables and trims', () => {
    expect(decodeModel(Uint8Array.of(0x00, 0x20, 0x41, 0x42, 0x0d, 0x0a, 0x20))).toBe('AB');
    expect(decodeModel(new Uint8Array(0))).toBe('');
  });
});

describe('describeTx', () => {
  it('names known commands', () => {
    expect(describeTx(Cmd.wakeup())).toBe('Wakeup');
    expect(describeTx(Cmd.model())).toBe('Query model');
    expect(describeTx(Cmd.battery())).toBe('Query battery');
    expect(describeTx(Cmd.status())).toBe('Query status');
    expect(describeTx(Cmd.density(2))).toBe('Set density 2');
    expect(describeTx(Cmd.paperMode(2))).toBe('Set paper mode 2');
    expect(describeTx(Cmd.enable())).toBe('Enable printer');
    expect(describeTx(Cmd.stop())).toBe('Stop print');
    expect(describeTx(Cmd.feed(80))).toBe('Feed 80 rows (10.0 mm)');
    expect(describeTx(Cmd.formFeed())).toBe('Form feed');
    expect(describeTx(Cmd.rasterHeader(204, 300))).toBe('Raster header 1632x300');
  });
  it('returns null for unknown data', () => {
    expect(describeTx(Uint8Array.of(0x55, 0xaa))).toBeNull();
    expect(describeTx(new Uint8Array(0))).toBeNull();
    expect(describeTx(new Uint8Array(11))).toBeNull();
    expect(describeTx(new Uint8Array(13))).toBeNull();
  });
});
