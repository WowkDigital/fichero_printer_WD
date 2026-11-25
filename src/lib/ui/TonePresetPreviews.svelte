<script lang="ts">
  import { app } from '../app.svelte';
  import { AUTO_TONE_PRESETS, STATIC_TONE_PRESETS, autoTone } from '../image/tone-presets';
  import { DEFAULT_TONE, type Bitmap1, type ToneParams } from '../image/types';
  import BitmapCanvas from './BitmapCanvas.svelte';

  interface PresetPreview {
    label: string;
    tone: ToneParams;
    bitmap?: Bitmap1 | null;
  }

  let previews = $state.raw<PresetPreview[]>([]);
  let failed = $state(false);

  $effect(() => {
    const { source, raster } = app.settings;
    JSON.stringify([source, raster.headDots]);
    const image = app.image;
    previews = [];
    failed = false;
    let active = true;

    async function render() {
      const presets: PresetPreview[] = STATIC_TONE_PRESETS.map(({ label, tone }) => ({
        label,
        tone: { ...DEFAULT_TONE, ...tone },
      }));
      if (source.type === 'image' && image) {
        for (const { id, label } of AUTO_TONE_PRESETS) presets.push({ label, tone: autoTone(image, id) });
      }
      previews = presets;
      for (const [index, preset] of presets.entries()) {
        const bitmap = await app.renderSource(preset.tone, 240);
        if (!active) return;
        previews = previews.map((preview, i) => i === index ? { ...preview, bitmap } : preview);
      }
    }

    const timer = setTimeout(() => {
      void render().catch(() => { if (active) failed = true; });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  });
</script>

{#if failed}
  <p class="text-sm text-warn" role="alert">Could not render the preset previews.</p>
{:else if app.settings.source.type === 'image' && !app.image}
  <p class="text-sm text-dim">Choose an image to preview presets.</p>
{:else}
  <p class="text-xs text-dim">Previews show up to the first 30 mm of the source.</p>
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {#each previews as preset (preset.label)}
      <button
        class="btn flex min-w-0 flex-col !items-stretch gap-2 !p-2 text-left"
        type="button"
        disabled={!preset.bitmap}
        aria-label="Apply {preset.label}"
        onclick={() => (app.settings.tone = { ...preset.tone })}
      >
        <span>{preset.label}</span>
        {#if preset.bitmap}
          <BitmapCanvas bitmap={preset.bitmap} label="{preset.label} preview" />
        {:else}
          <span class="text-xs text-dim">Rendering…</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
