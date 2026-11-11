<script lang="ts">
  import { app } from '../app.svelte';
  import { DOTS_PER_MM } from '../core/protocol';
  import { blackRatio } from '../image/dither';
  import type { Bitmap1 } from '../image/types';
  import { GALLERY_SWEEPS, galleryVariants, type Variant } from '../lab/config';
  import { printContactSheet } from '../lab/experiments.svelte';
  import BitmapCanvas from './BitmapCanvas.svelte';
  import Segmented from './Segmented.svelte';
  import Slider from './Slider.svelte';

  const g = $derived(app.settings.lab.gallery);

  let items = $state.raw<{ variant: Variant; bitmap: Bitmap1 | null }[]>([]);
  let done = $state(0);
  let token = 0;

  // Re-render every variant (debounced, one after another) when the source, tone or sweep changes.
  $effect(() => {
    const { tone, source, raster } = app.settings;
    JSON.stringify([tone, source, raster.headDots, g.sweep, g.maxMm]);
    app.image;
    const variants = galleryVariants(g.sweep, $state.snapshot(tone));
    const maxRows = Math.max(8, Math.round(g.maxMm * DOTS_PER_MM));
    const mine = ++token;
    const timer = setTimeout(async () => {
      items = variants.map((variant) => ({ variant, bitmap: null }));
      done = 0;
      for (let i = 0; i < variants.length; i++) {
        let bitmap: Bitmap1 | null = null;
        try {
          bitmap = await app.renderSource(variants[i].tone, maxRows);
        } catch (err) {
          app.error = String((err as Error)?.message ?? err);
        }
        if (mine !== token) return;
        items = items.map((item, j) => (j === i ? { ...item, bitmap } : item));
        done = i + 1;
      }
    }, 250);
    return () => clearTimeout(timer);
  });

  const current = $derived(JSON.stringify(app.settings.tone));
  const ready = $derived(items.length > 0 && done === items.length && items.every((i) => i.bitmap));
  const truncated = $derived(app.bitmap ? app.bitmap.height > g.maxMm * DOTS_PER_MM : false);

  // Scroll all zoomed cards together so the same detail stays side by side.
  let syncing = false;
  function syncScroll(event: Event) {
    if (syncing) return;
    const source = event.currentTarget as HTMLElement;
    syncing = true;
    for (const el of document.querySelectorAll<HTMLElement>('[data-gallery-scroll]')) {
      if (el !== source) {
        el.scrollLeft = source.scrollLeft;
        el.scrollTop = source.scrollTop;
      }
    }
    requestAnimationFrame(() => (syncing = false));
  }
</script>

<div class="mx-auto max-w-7xl space-y-4 p-4">
  <section class="card space-y-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-lg font-bold">Algorithms gallery</h2>
        <p class="text-sm text-dim">
          The Print tab source rendered with every variant at once. Pick one to use it, or print them all on one strip.
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary"
        disabled={!ready || !app.canRun}
        title={app.canRun ? 'Print every variant with its caption' : 'Connect a printer or switch the output to Simulate'}
        onclick={() => printContactSheet(items.map((i) => ({ variant: i.variant, bitmap: i.bitmap! })))}
      >
        Print contact sheet
      </button>
    </div>
    <div>
      <div class="label mb-1.5">Compare</div>
      <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Compare">
        {#each GALLERY_SWEEPS as sweep (sweep.id)}
          <button
            type="button"
            role="radio"
            aria-checked={g.sweep === sweep.id}
            class="min-h-9 rounded-full border px-3 text-sm font-semibold transition-colors {g.sweep === sweep.id
              ? 'border-accent bg-accent text-on-accent'
              : 'border-line text-dim hover:text-fg'}"
            onclick={() => (app.settings.lab.gallery.sweep = sweep.id)}
          >
            {sweep.label}
          </button>
        {/each}
      </div>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <Segmented
        label="Zoom"
        bind:value={app.settings.lab.gallery.zoom}
        options={[
          { value: 0, label: 'Fit' },
          { value: 1, label: '1×' },
          { value: 2, label: '2×' },
          { value: 4, label: '4×' },
        ]}
      />
      <Slider label="Rendered height" bind:value={app.settings.lab.gallery.maxMm} min={5} max={300} unit="mm" hint={truncated ? 'Only the top of the source is shown.' : 'Lower is faster for big images.'} />
    </div>
    {#if items.length && done < items.length}
      <p class="text-xs text-dim" aria-live="polite">Rendering {done} / {items.length}…</p>
    {/if}
  </section>

  {#if !app.bitmap && app.settings.source.type === 'image' && !app.image}
    <p class="card p-6 text-center text-sm text-dim">Choose an image on the Print tab first.</p>
  {:else}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {#each items as item (item.variant.label)}
        {@const active = JSON.stringify(item.variant.tone) === current}
        <article class="card overflow-hidden {active ? 'ring-2 ring-accent' : ''}">
          <div class="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-semibold">{item.variant.label}</h3>
              <p class="font-mono text-xs text-dim">{item.bitmap ? `${(blackRatio(item.bitmap) * 100).toFixed(1)}% black` : 'Rendering…'}</p>
            </div>
            <button
              type="button"
              class="btn btn-sm {active ? 'btn-primary' : ''}"
              disabled={active}
              onclick={() => (app.settings.tone = { ...item.variant.tone })}
            >
              {active ? 'In use' : 'Use'}
            </button>
          </div>
          <div class="max-h-80 overflow-auto bg-raised p-2" data-gallery-scroll onscroll={syncScroll}>
            {#if item.bitmap}
              <BitmapCanvas bitmap={item.bitmap} scale={g.zoom} label={item.variant.label} />
            {:else}
              <div class="h-32 animate-pulse rounded bg-line/40"></div>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>
