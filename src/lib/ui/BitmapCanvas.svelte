<script lang="ts">
  import type { Bitmap1 } from '../image/types';

  interface Props {
    bitmap: Bitmap1;
    /** CSS pixels per dot; 0 = fit to the container width. */
    scale?: number;
    label?: string;
  }
  let { bitmap, scale = 0, label = '' }: Props = $props();

  let canvas = $state<HTMLCanvasElement>();

  $effect(() => {
    const el = canvas;
    if (!el) return;
    const { width, height, data } = bitmap;
    el.width = Math.max(1, width);
    el.height = Math.max(1, height);
    const ctx = el.getContext('2d')!;
    const image = ctx.createImageData(el.width, el.height);
    const px = new Uint32Array(image.data.buffer);
    for (let i = 0; i < data.length; i++) px[i] = data[i] ? 0xff000000 : 0xffffffff;
    ctx.putImageData(image, 0, 0);
  });
</script>

<canvas
  bind:this={canvas}
  class="block bg-white {scale ? 'max-w-none' : 'h-auto w-full'}"
  style:width={scale ? `${bitmap.width * scale}px` : undefined}
  style:image-rendering={scale >= 1 ? 'pixelated' : 'auto'}
  aria-label={label}
></canvas>
