/** Display formatting shared by the views. */
import { DOTS_PER_MM } from '../core/protocol';

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`;
}

export function formatDuration(sec: number): string {
  return sec >= 60 ? `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s` : `${sec.toFixed(1)} s`;
}

/** Dot rows to paper length. */
export function formatPaper(rows: number): string {
  const mm = rows / DOTS_PER_MM;
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(mm < 10 ? 1 : 0)} mm`;
}
