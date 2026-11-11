/** Byte helpers shared by the protocol layer and the packet inspector. */

export function toHex(data: Uint8Array, sep = ' '): string {
  let out = '';
  for (let i = 0; i < data.length; i++) {
    if (i) out += sep;
    out += data[i].toString(16).padStart(2, '0').toUpperCase();
  }
  return out;
}

/** Printable ASCII, everything else rendered as a dot. */
export function toAscii(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
  }
  return out;
}

/**
 * Parse user-entered hex: "10 FF 40", "10ff40", "0x10, 0xFF", "10:FF:40".
 * Throws with a readable message on invalid input.
 */
export function parseHex(input: string): Uint8Array {
  const cleaned = input.replace(/0x/gi, '').replace(/[\s,:;_-]+/g, '');
  if (cleaned.length === 0) throw new Error('Enter at least one byte');
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) throw new Error('Only hex digits 0-9 and A-F are allowed');
  if (cleaned.length % 2 !== 0) throw new Error('Odd number of hex digits - each byte needs two');
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function startsWith(data: Uint8Array, prefix: ArrayLike<number>): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
