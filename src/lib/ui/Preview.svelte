<script lang="ts">
  import type { Align } from '../core/raster';
  import type { Bitmap1 } from '../image/types';

  interface Props {
    bitmap: Bitmap1 | null;
    headDots: number;
    align: Align;
    offsetDots: number;
    busy: boolean;
  }
  let { bitmap, headDots, align, offsetDots, busy }: Props = $props();

  let canvas = $state<HTMLCanvasElement>();
  let actualSize = $state(false);

  // Paint the bitmap exactly as it lands on the head: aligned, shifted and clipped.
  $effect(() => {
    const el = canvas;
    if (!el || !bitmap) return;
    const { width, height, data } = bitmap;
    el.width = headDots;
    el.height = height;
    const ctx = el.getContext('2d')!;
    const image = ctx.createImageData(headDots, height);
    const px = new Uint32Array(image.data.buffer);
    px.fill(0xffffffff);
    const base = align === 'center' ? Math.floor((headDots - width) / 2) : align === 'right' ? headDots - width : 0;
    const x0 = base + Math.round(offsetDots);
    const from = Math.max(0, -x0);
    const to = Math.min(width, headDots - x0);
    for (let y = 0; y < height; y++) {
      const src = y * width;
      const dst = y * headDots + x0;
      for (let x = from; x < to; x++) if (data[src + x]) px[dst + x] = 0xff000000;
    }
    ctx.putImageData(image, 0, 0);
  });
</script>

<div class="card overflow-hidden">
  <div class="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
    <span class="label">Preview · 1-bit, as printed</span>
    <div class="flex items-center gap-2">
      {#if busy}<span class="text-xs text-dim" aria-live="polite">Rendering…</span>{/if}
      <button type="button" class="btn btn-sm" disabled={!bitmap} aria-pressed={actualSize} onclick={() => (actualSize = !actualSize)}>
        {actualSize ? 'Fit width' : 'Actual dots'}
      </button>
    </div>
  </div>
  <div class="max-h-[46dvh] overflow-auto bg-raised p-3 lg:max-h-[calc(100dvh-16rem)]">
    {#if bitmap}
      <canvas
        bind:this={canvas}
        class="mx-auto block bg-white shadow-md {actualSize ? 'max-w-none' : 'h-auto w-full'}"
        style:image-rendering={actualSize ? 'pixelated' : 'auto'}
        aria-label="Print preview"
      ></canvas>
    {:else}
      <div class="flex h-40 items-center justify-center text-center text-sm text-dim">
        {busy ? 'Rendering preview…' : 'Nothing to preview yet. Pick a source below.'}
      </div>
    {/if}
  </div>
</div>
