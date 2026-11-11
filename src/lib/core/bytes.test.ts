import { describe, expect, it } from 'vitest';
import { concatBytes, parseHex, startsWith, toAscii, toHex } from './bytes';

describe('toHex', () => {
  it('formats uppercase, zero padded, space separated', () => {
    expect(toHex(Uint8Array.of(0x10, 0xff, 0x0a, 0x00))).toBe('10 FF 0A 00');
  });
  it('supports a custom separator and empty input', () => {
    expect(toHex(Uint8Array.of(1, 2, 3), '')).toBe('010203');
    expect(toHex(Uint8Array.of(1, 2), ':')).toBe('01:02');
    expect(toHex(new Uint8Array(0))).toBe('');
  });
});

describe('toAscii', () => {
  it('keeps printable ASCII and replaces others with dots', () => {
    expect(toAscii(Uint8Array.of(0x41, 0x20, 0x7e, 0x1f, 0x7f, 0x00, 0xff))).toBe('A ~....');
  });
  it('handles empty input', () => {
    expect(toAscii(new Uint8Array(0))).toBe('');
  });
});

describe('parseHex', () => {
  const expected = [0x10, 0xff, 0x40];
  it.each([
    ['spaces', '10 FF 40'],
    ['no separators', '10ff40'],
    ['0x prefixes', '0x10 0xFF 0x40'],
    ['0x prefixes with commas', '0x10, 0xFF, 0x40'],
    ['colons', '10:FF:40'],
    ['commas', '10,ff,40'],
    ['mixed whitespace', '  10\tFF\n40  '],
  ])('accepts %s', (_name, input) => {
    expect(Array.from(parseHex(input))).toEqual(expected);
  });

  it('throws on empty input', () => {
    expect(() => parseHex('')).toThrow(/at least one byte/i);
    expect(() => parseHex('   ')).toThrow(/at least one byte/i);
  });
  it('throws on an odd number of digits', () => {
    expect(() => parseHex('10F')).toThrow(/odd/i);
  });
  it('throws on non-hex characters', () => {
    expect(() => parseHex('10 GG')).toThrow(/hex digits/i);
    expect(() => parseHex('xyz')).toThrow(/hex digits/i);
  });
});

describe('concatBytes', () => {
  it('concatenates parts in order', () => {
    const out = concatBytes([Uint8Array.of(1, 2), new Uint8Array(0), Uint8Array.of(3)]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
  it('returns an empty array for no parts', () => {
    expect(concatBytes([]).length).toBe(0);
  });
});

describe('startsWith', () => {
  const data = Uint8Array.of(0x10, 0xff, 0x40, 0x01);
  it('matches a prefix', () => {
    expect(startsWith(data, [0x10, 0xff])).toBe(true);
    expect(startsWith(data, [])).toBe(true);
    expect(startsWith(data, data)).toBe(true);
  });
  it('rejects mismatch or longer prefix', () => {
    expect(startsWith(data, [0x10, 0xfe])).toBe(false);
    expect(startsWith(data, [0x10, 0xff, 0x40, 0x01, 0x00])).toBe(false);
  });
});
