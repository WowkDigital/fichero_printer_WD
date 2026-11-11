/// <reference lib="webworker" />
/** Dithering worker: keeps tone mapping and error diffusion off the UI thread. */
import { processRgba } from './dither';
import type { ToneParams } from './types';

export interface DitherRequest {
  id: number;
  rgba: ArrayBuffer;
  width: number;
  height: number;
  tone: ToneParams;
}

export interface DitherResponse {
  id: number;
  width: number;
  height: number;
  data: ArrayBuffer;
}

self.onmessage = (event: MessageEvent<DitherRequest>) => {
  const { id, rgba, width, height, tone } = event.data;
  const bmp = processRgba(new Uint8ClampedArray(rgba), width, height, tone);
  const data = bmp.data.buffer as ArrayBuffer;
  const response: DitherResponse = { id, width: bmp.width, height: bmp.height, data };
  (self as DedicatedWorkerGlobalScope).postMessage(response, [data]);
};
