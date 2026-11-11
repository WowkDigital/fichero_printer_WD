<script lang="ts">
  import { app } from '../app.svelte';
  import { DOTS_PER_MM, HEAD_FULL, HEAD_STANDARD, TEAR_BAR_ROWS } from '../core/protocol';
  import { blackRatio } from '../image/dither';
  import { PATTERNS } from '../image/patterns';
  import { DEFAULT_TONE, DITHER_MODES } from '../image/types';
  import Preview from './Preview.svelte';
  import Section from './Section.svelte';
  import Segmented from './Segmented.svelte';
  import Slider from './Slider.svelte';
  import Toggle from './Toggle.svelte';

  const s = $derived(app.settings);
  const src = $derived(app.settings.source);

  // Re-render the preview whenever anything that affects the bitmap changes.
  $effect(() => {
    JSON.stringify([s.tone, s.source, s.raster.headDots]);
    app.image;
    app.scheduleRender();
  });

  const stats = $derived.by(() => {
    const bmp = app.bitmap;
    if (!bmp) return null;
    return {
      size: `${bmp.width} × ${bmp.height} dots`,
      mm: `${(bmp.width / DOTS_PER_MM).toFixed(0)} × ${(bmp.height / DOTS_PER_MM).toFixed(0)} mm`,
      black: `${(blackRatio(bmp) * 100).toFixed(1)}%`,
      bytes: formatBytes(app.payloadBytes),
      time: formatDuration(app.estimatedSeconds),
    };
  });

  const progressPct = $derived(
    app.jobProgress && app.jobProgress.totalBytes > 0 ? (app.jobProgress.sentBytes / app.jobProgress.totalBytes) * 100 : 0,
  );
  const throughput = $derived(
    app.jobProgress && app.jobProgress.elapsedMs > 0 ? (app.jobProgress.sentBytes / app.jobProgress.elapsedMs) * 1000 : 0,
  );

  const isDiffusion = $derived(!['threshold', 'bayer2', 'bayer4', 'bayer8', 'halftone'].includes(s.tone.dither));
  const ditherLabel = $derived(DITHER_MODES.find((m) => m.id === s.tone.dither)?.label ?? '');

  function formatBytes(n: number) {
    return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`;
  }
  function formatDuration(sec: number) {
    return sec >= 60 ? `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s` : `${sec.toFixed(1)} s`;
  }
  function onFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void app.loadImage(file);
    input.value = '';
  }
</script>

<div class="mx-auto max-w-6xl p-4 pb-28 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-4">
  <!-- Preview column (sticky on wide screens) -->
  <div class="space-y-3 lg:sticky lg:top-4">
    <Preview bitmap={app.bitmap} headDots={s.raster.headDots} align={s.raster.align} offsetDots={s.raster.offsetDots} busy={app.rendering} />
    {#if stats}
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 px-1 text-sm sm:grid-cols-5">
        <div><dt class="text-xs text-dim">Bitmap</dt><dd class="font-mono text-[13px]">{stats.size}</dd></div>
        <div><dt class="text-xs text-dim">On paper</dt><dd class="font-mono text-[13px]">{stats.mm}</dd></div>
        <div><dt class="text-xs text-dim">Black coverage</dt><dd class="font-mono text-[13px]">{stats.black}</dd></div>
        <div><dt class="text-xs text-dim">Payload</dt><dd class="font-mono text-[13px]">{stats.bytes}</dd></div>
        <div><dt class="text-xs text-dim">Min. transfer time</dt><dd class="font-mono text-[13px]">{stats.time}</dd></div>
      </dl>
    {/if}
  </div>

  <!-- Controls column -->
  <div class="mt-4 space-y-3 lg:mt-0">
    <section class="card space-y-4 p-4">
      <Segmented
        label="Source"
        bind:value={src.type}
        options={[
          { value: 'image', label: 'Image' },
          { value: 'text', label: 'Text' },
          { value: 'pattern', label: 'Test pattern' },
        ]}
      />

      {#if src.type === 'image'}
        <label class="btn w-full cursor-pointer {app.image ? '' : 'btn-primary'}">
          {app.image ? 'Replace image' : 'Choose image'}
          <input type="file" accept="image/*" class="sr-only" onchange={onFile} />
        </label>
        {#if app.image}
          <p class="truncate text-xs text-dim">{app.imageName} · {app.image.width} × {app.image.height} px</p>
          <Segmented
            label="Size"
            bind:value={src.image.fit}
            options={[
              { value: 'head', label: 'Fit head width' },
              { value: 'scale', label: 'Custom scale' },
            ]}
          />
          {#if src.image.fit === 'scale'}
            <Slider label="Scale" bind:value={src.image.scalePct} min={5} max={400} unit="%" hint="100% prints one image pixel per dot." />
          {/if}
          <Segmented
            label="Rotation"
            bind:value={src.image.rotate}
            options={[
              { value: 0, label: '0°' },
              { value: 90, label: '90°' },
              { value: 180, label: '180°' },
              { value: 270, label: '270°' },
            ]}
          />
        {/if}
      {:else if src.type === 'text'}
        <div>
          <label class="label" for="print-text">Text</label>
          <textarea id="print-text" class="field mt-1.5 min-h-28 resize-y" bind:value={src.text.text} placeholder="Type what to print"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="print-font">Font</label>
            <select id="print-font" class="field mt-1.5" bind:value={src.text.font}>
              <option value="sans-serif">Sans-serif</option>
              <option value="serif">Serif</option>
              <option value="monospace">Monospace</option>
            </select>
          </div>
          <Segmented
            label="Align"
            bind:value={src.text.align}
            options={[
              { value: 'left', label: 'L' },
              { value: 'center', label: 'C' },
              { value: 'right', label: 'R' },
            ]}
          />
        </div>
        <Slider label="Font size" bind:value={src.text.size} min={16} max={400} unit="dots" hint="{(src.text.size / DOTS_PER_MM).toFixed(1)} mm tall" />
        <Slider label="Line height" bind:value={src.text.lineHeight} min={0.8} max={2.5} step={0.05} unit="×" />
        <Slider label="Padding" bind:value={src.text.padding} min={0} max={200} unit="dots" />
        <Toggle label="Bold" bind:checked={src.text.bold} />
      {:else}
        <div>
          <label class="label" for="print-pattern">Pattern</label>
          <select id="print-pattern" class="field mt-1.5" bind:value={src.pattern.id}>
            {#each PATTERNS as pattern (pattern.id)}
              <option value={pattern.id}>{pattern.label}</option>
            {/each}
          </select>
          <p class="mt-1.5 text-xs text-dim">{PATTERNS.find((p) => p.id === src.pattern.id)?.description}</p>
        </div>
        <Slider label="Height" bind:value={src.pattern.heightMm} min={5} max={300} unit="mm" />
        <Slider label="Cell size" bind:value={src.pattern.cell} min={1} max={128} unit="dots" hint="Used by checker, stripes and grid." />
      {/if}
    </section>

    <Section title="Tone and dithering" summary="{ditherLabel} · gamma {s.tone.gamma}" open>
      <div>
        <label class="label" for="print-dither">Algorithm</label>
        <select id="print-dither" class="field mt-1.5" bind:value={s.tone.dither}>
          {#each DITHER_MODES as mode (mode.id)}
            <option value={mode.id}>{mode.label}</option>
          {/each}
        </select>
      </div>
      <Slider label="Threshold" bind:value={s.tone.threshold} min={0} max={255} hint="Black/white cut-off; shifts overall darkness in dithered modes." />
      <Slider label="Brightness" bind:value={s.tone.brightness} min={-100} max={100} />
      <Slider label="Contrast" bind:value={s.tone.contrast} min={-100} max={100} />
      <Slider label="Gamma" bind:value={s.tone.gamma} min={0.1} max={3} step={0.05} hint="Above 1 brightens midtones." />
      {#if s.tone.dither === 'halftone'}
        <Slider label="Halftone cell" bind:value={s.tone.halftoneCell} min={4} max={16} unit="dots" />
      {/if}
      {#if isDiffusion}
        <Toggle label="Serpentine scan" bind:checked={s.tone.serpentine} hint="Alternate direction per row to reduce directional artifacts." />
      {/if}
      <Toggle label="Invert" bind:checked={s.tone.invert} />
      <button type="button" class="btn btn-sm" onclick={() => (app.settings.tone = { ...DEFAULT_TONE })}>Reset tone</button>
    </Section>

    <Section title="Paper layout" summary="{s.raster.headDots} dots · {s.raster.align} · tail {s.raster.tailRows} rows">
      <Segmented
        label="Head width"
        bind:value={s.raster.headDots}
        options={[
          { value: HEAD_STANDARD, label: `${HEAD_STANDARD} (204 mm)` },
          { value: HEAD_FULL, label: `${HEAD_FULL} (210 mm)` },
        ]}
      />
      <Segmented
        label="Horizontal alignment"
        bind:value={s.raster.align}
        options={[
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Center' },
          { value: 'right', label: 'Right' },
        ]}
      />
      <Slider label="Horizontal offset" bind:value={s.raster.offsetDots} min={-400} max={400} unit="dots" />
      <Slider label="Blank rows before" bind:value={s.raster.leadRows} min={0} max={800} unit="rows" />
      <Slider
        label="Blank rows after"
        bind:value={s.raster.tailRows}
        min={0}
        max={800}
        unit="rows"
        hint="{TEAR_BAR_ROWS} rows (20 mm) pushes the print past the tear bar."
      />
      <Slider label="Rows per raster frame" bind:value={s.raster.bandRows} min={0} max={2000} step={8} unit="rows" hint="0 sends the whole job as one GS v 0 frame." />
    </Section>

    <Section title="Job and transport" summary="density {s.job.density} · {s.job.chunkSize} B / {s.job.chunkDelayMs} ms">
      <Segmented
        label="Density"
        bind:value={s.job.density}
        options={[
          { value: 0, label: 'Light' },
          { value: 1, label: 'Normal' },
          { value: 2, label: 'High' },
        ]}
      />
      <Slider label="Chunk size" bind:value={s.job.chunkSize} min={20} max={244} unit="B" hint="Bytes per BLE write. The link allows up to 244." />
      <Slider label="Delay between chunks" bind:value={s.job.chunkDelayMs} min={0} max={100} unit="ms" hint="Too low overflows the printer buffer and drops lines." />
      <Slider label="Pause before stop" bind:value={s.job.finishPauseMs} min={0} max={3000} step={50} unit="ms" />
      <Slider label="ACK timeout" bind:value={s.job.ackTimeoutMs} min={500} max={20000} step={500} unit="ms" />
      <div class="divide-y divide-line border-t border-line">
        <Toggle label="Send density" mono="10 FF 10 00 n" bind:checked={s.job.sendDensity} />
        <Toggle label="Send paper mode (continuous roll)" mono="10 FF 84 02" bind:checked={s.job.sendPaperMode} />
        <Toggle label="Send wakeup" mono="12 × 00" bind:checked={s.job.sendWakeup} />
        <Toggle label="Send enable" mono="10 FF FE 01" bind:checked={s.job.sendEnable} />
        <Toggle label="Send stop and wait for ACK" mono="10 FF FE 45 → AA" bind:checked={s.job.sendStop} />
        <Toggle label="Write with response" bind:checked={s.job.writeWithResponse} hint="Slower, but each chunk is confirmed by the link layer." />
      </div>
    </Section>
  </div>
</div>

<!-- Sticky action bar, always reachable with the thumb -->
<div class="pointer-events-none fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-10 px-3 pb-3 md:bottom-0 md:left-20">
  <div class="card pointer-events-auto mx-auto max-w-2xl p-3 shadow-lg shadow-black/20">
    {#if app.jobRunning}
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-sm">
            <span class="block font-semibold" aria-live="polite">
              {app.jobProgress?.phase === 'finish' ? 'Finishing…' : app.jobProgress?.phase === 'setup' ? 'Starting…' : `Sending ${progressPct.toFixed(0)}%`}
            </span>
            <span class="block truncate font-mono text-xs text-dim">
              {formatBytes(app.jobProgress?.sentBytes ?? 0)} / {formatBytes(app.jobProgress?.totalBytes ?? 0)} · {formatBytes(Math.round(throughput))}/s
            </span>
          </div>
          <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Print progress" aria-valuenow={Math.round(progressPct)} aria-valuemin={0} aria-valuemax={100}>
            <div class="h-full rounded-full bg-accent" style:width="{progressPct}%"></div>
          </div>
        </div>
        <button type="button" class="btn btn-danger" onclick={() => app.cancelPrint()}>Cancel</button>
      </div>
    {:else}
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1 text-sm">
          {#if app.jobResult}
            <p class="font-semibold {app.jobResult.cancelled || app.jobResult.acknowledged === false ? 'text-warn' : 'text-ok'}">
              {app.jobResult.cancelled ? 'Cancelled' : app.jobResult.acknowledged === false ? 'Sent, no ACK from printer' : app.jobResult.acknowledged ? 'Printed, ACK received' : 'Sent'}
            </p>
            <p class="truncate font-mono text-xs text-dim">
              {formatBytes(app.jobResult.sentBytes)} in {formatDuration(app.jobResult.durationMs / 1000)}
            </p>
          {:else if !app.connected}
            <p class="text-dim">Connect a printer to print.</p>
          {:else if !app.bitmap}
            <p class="text-dim">Nothing to print yet.</p>
          {:else}
            <p class="font-semibold">Ready</p>
            <p class="truncate font-mono text-xs text-dim">{stats?.bytes} · about {stats?.time}</p>
          {/if}
        </div>
        {#if app.connected}
          <button type="button" class="btn btn-primary min-w-28" disabled={!app.bitmap || app.rendering} onclick={() => app.print()}>Print</button>
        {:else}
          <button type="button" class="btn btn-primary" onclick={() => (app.tab = 'device')}>Connect</button>
        {/if}
      </div>
    {/if}
  </div>
</div>
