<script lang="ts">
  import { tick } from 'svelte';
  import { DOTS_PER_MM } from '../core/protocol';
  import type { RasterOptions } from '../core/raster';
  import { inkBounds } from '../image/compose';
  import type { Bitmap1 } from '../image/types';

  interface Props {
    bitmap: Bitmap1 | null;
    raster: RasterOptions;
    busy: boolean;
    /** Shown in the corner, e.g. "Blank run". */
    badge?: string;
  }
  let { bitmap, raster, busy, badge = '' }: Props = $props();

  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 16;

  let canvas = $state<HTMLCanvasElement>();
  let viewport = $state<HTMLDivElement>();
  /** CSS pixels per dot; 0 = fit to width. */
  let zoom = $state(0);
  let fitZoom = $state(0.4);
  let showMargins = $state(true);

  const scale = $derived(zoom || fitZoom);
  const lead = $derived(Math.max(0, Math.round(raster.leadRows)));
  const tail = $derived(Math.max(0, Math.round(raster.tailRows)));

  /** Where the bitmap's left edge lands on the head. */
  const x0 = $derived.by(() => {
    if (!bitmap) return 0;
    const base = raster.align === 'center' ? Math.floor((raster.headDots - bitmap.width) / 2) : raster.align === 'right' ? raster.headDots - bitmap.width : 0;
    return base + Math.round(raster.offsetDots);
  });

  /** Margins around the inked area, in dots, on the paper as it will come out. */
  const margins = $derived.by(() => {
    if (!bitmap) return null;
    const ink = inkBounds(bitmap);
    const head = raster.headDots;
    const paper = lead + bitmap.height + tail;
    if (!ink) return { blank: true, paper, top: 0, bottom: 0, left: 0, right: 0, inkW: 0, inkH: 0, clipped: false, ink: null };
    const left = Math.max(0, Math.min(head, x0 + ink.left));
    const right = Math.max(0, Math.min(head, x0 + ink.right));
    return {
      blank: false,
      paper,
      top: lead + ink.top,
      topInBitmap: ink.top,
      bottom: tail + (bitmap.height - ink.bottom),
      bottomInBitmap: bitmap.height - ink.bottom,
      left,
      right: head - right,
      inkW: right - left,
      inkH: ink.bottom - ink.top,
      clipped: x0 + ink.left < 0 || x0 + ink.right > head,
      ink: { left, right, top: lead + ink.top, bottom: lead + ink.bottom },
    };
  });

  const mm = (dots: number) => (dots / DOTS_PER_MM).toFixed(1);

  // Paint the paper exactly as it comes out: blank lead rows, the aligned and clipped bitmap, blank tail rows.
  $effect(() => {
    const el = canvas;
    if (!el || !bitmap) return;
    const head = raster.headDots;
    const { width, height, data } = bitmap;
    const rows = lead + height + tail;
    el.width = head;
    el.height = Math.max(1, rows);
    const ctx = el.getContext('2d')!;
    const image = ctx.createImageData(head, Math.max(1, rows));
    const px = new Uint32Array(image.data.buffer);
    px.fill(0xffffffff);
    const from = Math.max(0, -x0);
    const to = Math.min(width, head - x0);
    for (let y = 0; y < height; y++) {
      const src = y * width;
      const dst = (lead + y) * head + x0;
      for (let x = from; x < to; x++) if (data[src + x]) px[dst + x] = 0xff000000;
    }
    ctx.putImageData(image, 0, 0);

    const m = margins;
    if (!showMargins || !m) return;
    // Blank lead/tail rows in blue, unused paper around the ink in amber.
    ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';
    if (lead) ctx.fillRect(0, 0, head, lead);
    if (tail) ctx.fillRect(0, lead + height, head, tail);
    if (m.ink) {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.24)';
      const { left, right, top, bottom } = m.ink;
      ctx.fillRect(0, lead, head, top - lead);
      ctx.fillRect(0, bottom, head, lead + height - bottom);
      ctx.fillRect(0, top, left, bottom - top);
      ctx.fillRect(right, top, head - right, bottom - top);
      // Dashed outline of the ink box.
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([16, 10]);
      ctx.strokeRect(left, top, right - left, bottom - top);
    }
  });

  // Keep the fit zoom in sync with the viewport width.
  $effect(() => {
    const el = viewport;
    if (!el) return;
    const update = () => (fitZoom = Math.max(MIN_ZOOM, (el.clientWidth - 24) / raster.headDots));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  });

  /** Zoom to `next`, keeping the paper point under (cx, cy) (viewport coords) in place. */
  async function zoomTo(next: number, cx?: number, cy?: number) {
    const el = viewport;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (!el || !canvas) {
      zoom = clamped;
      return;
    }
    const ax = cx ?? el.clientWidth / 2;
    const ay = cy ?? el.clientHeight / 2;
    const rect = canvas.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    // Paper coordinates (in dots) of the anchor point before zooming.
    const px = (host.left + ax - rect.left) / scale;
    const py = (host.top + ay - rect.top) / scale;
    zoom = clamped;
    await tick();
    const after = canvas.getBoundingClientRect();
    el.scrollLeft += after.left + px * clamped - (host.left + ax);
    el.scrollTop += after.top + py * clamped - (host.top + ay);
  }

  const step = (factor: number) => zoomTo(scale * factor);

  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const host = viewport!.getBoundingClientRect();
    void zoomTo(scale * Math.exp(-event.deltaY * 0.0025), event.clientX - host.left, event.clientY - host.top);
  }

  // Two-finger pinch on touch screens.
  let pinch: { dist: number; zoom: number } | null = null;
  const touchDist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  function onTouchStart(event: TouchEvent) {
    if (event.touches.length === 2) pinch = { dist: touchDist(event), zoom: scale };
  }
  function onTouchMove(event: TouchEvent) {
    if (!pinch || event.touches.length !== 2) return;
    event.preventDefault();
    const host = viewport!.getBoundingClientRect();
    const cx = (event.touches[0].clientX + event.touches[1].clientX) / 2 - host.left;
    const cy = (event.touches[0].clientY + event.touches[1].clientY) / 2 - host.top;
    void zoomTo((pinch.zoom * touchDist(event)) / pinch.dist, cx, cy);
  }
  function onTouchEnd(event: TouchEvent) {
    if (event.touches.length < 2) pinch = null;
  }

  // Drag to pan with the mouse.
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  let dragging = $state(false);
  function onPointerDown(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !viewport || event.target !== canvas) return;
    drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    dragging = true;
    viewport.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent) {
    if (!drag || !viewport) return;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
  }
  function onPointerUp() {
    drag = null;
    dragging = false;
  }

  $effect(() => {
    const el = viewport;
    if (!el) return;
    // Non-passive so ctrl+wheel and pinch can stop the page from zooming.
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', onTouchMove);
    };
  });
</script>

<div class="card overflow-hidden">
  <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
    <span class="label">Preview · 1-bit, as printed {#if badge}<span class="ml-1 rounded-full bg-accent/15 px-2 py-0.5 text-accent">{badge}</span>{/if}</span>
    <div class="flex items-center gap-1">
      {#if busy}<span class="mr-1 text-xs text-dim" aria-live="polite">Rendering…</span>{/if}
      <button type="button" class="btn btn-sm !px-2.5" disabled={!bitmap} aria-pressed={showMargins} onclick={() => (showMargins = !showMargins)} title="Show margins">
        Margins
      </button>
      <button type="button" class="btn btn-sm !px-3" disabled={!bitmap} onclick={() => step(1 / 1.25)} aria-label="Zoom out">−</button>
      <button
        type="button"
        class="btn btn-sm w-16 !px-1 font-mono"
        disabled={!bitmap}
        onclick={() => (zoom ? (zoom = 0) : zoomTo(1))}
        title={zoom ? 'Fit to width' : 'Actual dots (1 dot = 1 px)'}
      >
        {zoom ? `${Math.round(scale * 100)}%` : 'Fit'}
      </button>
      <button type="button" class="btn btn-sm !px-3" disabled={!bitmap} onclick={() => step(1.25)} aria-label="Zoom in">+</button>
    </div>
  </div>
  <div
    bind:this={viewport}
    class="max-h-[46dvh] overflow-auto bg-raised p-3 lg:max-h-[calc(100dvh-19rem)] {dragging ? 'cursor-grabbing' : zoom ? 'cursor-grab' : ''}"
    style:touch-action="pan-x pan-y"
    role="presentation"
    ontouchstart={onTouchStart}
    ontouchend={onTouchEnd}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    {#if bitmap}
      <canvas
        bind:this={canvas}
        class="mx-auto block max-w-none bg-white shadow-md select-none"
        style:width="{raster.headDots * scale}px"
        style:image-rendering={scale >= 1 ? 'pixelated' : 'auto'}
        aria-label="Print preview"
      ></canvas>
    {:else}
      <div class="flex h-40 items-center justify-center text-center text-sm text-dim">
        {busy ? 'Rendering preview…' : 'Nothing to preview yet. Pick a source below.'}
      </div>
    {/if}
  </div>
  {#if margins && showMargins}
    <div class="border-t border-line px-3 py-2 text-xs">
      {#if margins.blank}
        <p class="text-warn">The job is blank: {mm(margins.paper)} mm of paper with nothing on it.</p>
      {:else}
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <span><span class="text-dim">Top</span> <span class="font-mono">{mm(margins.top)} mm</span></span>
          <span><span class="text-dim">Bottom</span> <span class="font-mono">{mm(margins.bottom)} mm</span></span>
          <span><span class="text-dim">Left</span> <span class="font-mono">{mm(margins.left)} mm</span></span>
          <span><span class="text-dim">Right</span> <span class="font-mono">{mm(margins.right)} mm</span></span>
        </div>
        <p class="mt-1 text-dim">
          <span class="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style="background: rgba(37, 99, 235, 0.45)"></span>blank rows
          {mm(lead)} + {mm(tail)} mm ·
          <span class="mr-1 ml-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style="background: rgba(245, 158, 11, 0.5)"></span>white inside the image
          {mm(margins.topInBitmap ?? 0)} top, {mm(margins.bottomInBitmap ?? 0)} bottom ·
          ink <span class="font-mono text-fg">{mm(margins.inkW)} × {mm(margins.inkH)} mm</span> ·
          paper <span class="font-mono text-fg">{mm(margins.paper)} mm</span>
          {#if margins.clipped}<span class="text-warn"> · clipped at the head edge</span>{/if}
        </p>
      {/if}
    </div>
  {/if}
</div>
