import { describe, expect, it } from 'vitest';
import { fillCounter, formatDate, parseNumberList, splitLines } from './format';

describe('formatDate', () => {
  const d = new Date(2026, 10, 3, 7, 5, 9, 42);
  it('replaces all tokens', () => {
    expect(formatDate('DD:MM:YYYY HH:mm:ss', d)).toBe('03:11:2026 07:05:09');
    expect(formatDate('YY-MM-DD HH:mm:ss.SSS', d)).toBe('26-11-03 07:05:09.042');
  });
  it('keeps other text', () => {
    expect(formatDate('Time: HH:mm', d)).toBe('Time: 07:05');
  });
});

describe('fillCounter', () => {
  it('fills {n} and {i}', () => {
    expect(fillCounter('#{n} ({i})', 4)).toBe('#5 (4)');
  });
});

describe('parseNumberList', () => {
  it('accepts commas and spaces, drops junk', () => {
    expect(parseNumberList('0, 1 2;x 3')).toEqual([0, 1, 2, 3]);
    expect(parseNumberList('')).toEqual([]);
  });
});

describe('splitLines', () => {
  it('drops empty lines by default', () => {
    expect(splitLines('a\r\n\nb\n  \nc')).toEqual(['a', 'b', 'c']);
    expect(splitLines('a\n\nb', true)).toEqual(['a', '', 'b']);
  });
});
