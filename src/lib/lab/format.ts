/** Text helpers for timed experiments. Framework-free. */

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/**
 * Format a date with a simple template.
 * Tokens: YYYY, YY, MM, DD, HH, mm, ss, SSS. Everything else is copied as is.
 */
export function formatDate(template: string, d: Date): string {
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: pad(d.getFullYear() % 100),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    SSS: pad(d.getMilliseconds(), 3),
  };
  return template.replace(/YYYY|YY|MM|DD|HH|mm|SSS|ss/g, (t) => tokens[t]);
}

/** Replace `{n}` with the 1-based tick number and `{i}` with the 0-based index. */
export function fillCounter(template: string, index: number): string {
  return template.replace(/\{n\}/g, String(index + 1)).replace(/\{i\}/g, String(index));
}

/** Parse "0, 1, 2" or "40 20 10" into numbers, dropping anything that is not a finite number. */
export function parseNumberList(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** Split text into non-empty lines (optionally keeping empty ones). */
export function splitLines(text: string, keepEmpty = false): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return keepEmpty ? lines : lines.filter((l) => l.trim() !== '');
}
