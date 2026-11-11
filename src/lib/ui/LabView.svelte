<script lang="ts">
  import { app } from '../app.svelte';
  import { DOTS_PER_MM } from '../core/protocol';
  import { measureText, textBitmap } from '../image/source';
  import { OUTPUT_MODES, SWEEP_KINDS } from '../lab/config';
  import { runSweep, runTicker, sweepResults, sweepSteps, tickerCount, tickerTickEstimate } from '../lab/experiments.svelte';
  import { fillCounter, formatDate, splitLines } from '../lab/format';
  import BitmapCanvas from './BitmapCanvas.svelte';
  import { formatBytes, formatDuration, formatPaper } from './format';
  import Section from './Section.svelte';
  import Segmented from './Segmented.svelte';
  import Slider from './Slider.svelte';
  import Toggle from './Toggle.svelte';

  const t = $derived(app.settings.lab.ticker);
  const sw = $derived(app.settings.lab.sweep);

  let now = $state(new Date());
  $effect(() => {
    const timer = setInterval(() => (now = new Date()), 250);
    return () => clearInterval(timer);
  });

  const sampleText = $derived(
    t.source === 'clock' ? formatDate(t.clockFormat, now) : t.source === 'lines' ? (splitLines(t.lines)[0] ?? '') : fillCounter(t.counterTemplate, 0),
  );
  const sample = $derived.by(() => {
    if (!sampleText) return null;
    const head = app.settings.raster.headDots;
    const width = t.narrow ? Math.min(head, Math.max(8, Math.ceil(measureText({ ...t.text, text: sampleText }) / 8) * 8)) : head;
    return textBitmap({ ...t.text, text: sampleText }, width);
  });

  const ticks = $derived(tickerCount(t));
  const perTick = $derived.by(() => {
    JSON.stringify([t, app.settings.job, app.settings.raster.headDots]);
    return tickerTickEstimate(t);
  });
  const tooSlow = $derived(perTick.seconds * 1000 > t.intervalMs);
  const totalSec = $derived(Math.max(ticks * (t.intervalMs / 1000), ticks * perTick.seconds));
  const totalRows = $derived(ticks * perTick.rows + t.tailRows);

  const sweepKind = $derived(SWEEP_KINDS.find((k) => k.id === sw.kind)!);
  const steps = $derived(sweepSteps(sw, app.settings.job));

  function setSweepKind(kind: typeof sw.kind) {
    app.settings.lab.sweep.kind = kind;
    const defaults = SWEEP_KINDS.find((k) => k.id === kind)?.defaults;
    if (defaults) app.settings.lab.sweep.values = defaults;
  }

  const outputHint = $derived(OUTPUT_MODES.find((m) => m.id === app.settings.output)?.hint ?? '');
  const blockedReason = $derived(app.jobRunning ? 'A job is running.' : !app.canRun ? 'Connect a printer, or switch the output to Simulate.' : '');
</script>

<div class="mx-auto max-w-3xl space-y-4 p-4">
  <section class="card space-y-3 p-4">
    <div>
      <h2 class="text-lg font-bold">Experiments</h2>
      <p class="text-sm text-dim">Every experiment, like Print, goes to the output chosen here or in the header.</p>
    </div>
    <div class="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Output">
      {#each OUTPUT_MODES as m (m.id)}
        <button
          type="button"
          role="radio"
          aria-checked={app.settings.output === m.id}
          disabled={app.jobRunning}
          class="rounded-[10px] border p-3 text-left transition-colors disabled:opacity-50 {app.settings.output === m.id
            ? 'border-accent bg-accent/10'
            : 'border-line hover:border-dim'}"
          onclick={() => (app.settings.output = m.id)}
        >
          <span class="block text-sm font-semibold {app.settings.output === m.id ? 'text-accent' : ''}">{m.label}</span>
          <span class="mt-0.5 block text-xs text-dim">{m.hint}</span>
        </button>
      {/each}
    </div>
    <p class="sr-only" aria-live="polite">{outputHint}</p>
  </section>

  <Section title="Timed ticker" summary="{ticks} ticks every {t.intervalMs} ms · {t.mode === 'stream' ? 'one job' : 'one job per tick'}" open>
    <Segmented
      label="Print"
      bind:value={app.settings.lab.ticker.source}
      options={[
        { value: 'clock', label: 'Clock' },
        { value: 'lines', label: 'Lines' },
        { value: 'counter', label: 'Counter' },
      ]}
    />

    {#if t.source === 'clock'}
      <div>
        <label class="label" for="ticker-format">Format</label>
        <input id="ticker-format" class="field mt-1.5 font-mono" bind:value={app.settings.lab.ticker.clockFormat} />
        <p class="mt-1 text-xs text-dim">Tokens: <span class="font-mono">YYYY YY MM DD HH mm ss SSS</span>. Now: <span class="font-mono text-fg">{formatDate(t.clockFormat, now)}</span></p>
      </div>
      <Slider label="Duration" bind:value={app.settings.lab.ticker.durationSec} min={1} max={600} unit="s" />
    {:else if t.source === 'lines'}
      <div>
        <label class="label" for="ticker-lines">Lines (one tick per line, empty lines skipped)</label>
        <textarea id="ticker-lines" class="field mt-1.5 min-h-28 resize-y font-mono" bind:value={app.settings.lab.ticker.lines}></textarea>
      </div>
    {:else}
      <div>
        <label class="label" for="ticker-counter">Template</label>
        <input id="ticker-counter" class="field mt-1.5 font-mono" bind:value={app.settings.lab.ticker.counterTemplate} />
        <p class="mt-1 text-xs text-dim"><span class="font-mono">{'{n}'}</span> = tick number from 1, <span class="font-mono">{'{i}'}</span> = from 0.</p>
      </div>
      <Slider label="Ticks" bind:value={app.settings.lab.ticker.count} min={1} max={500} />
    {/if}

    <Slider label="Interval" bind:value={app.settings.lab.ticker.intervalMs} min={100} max={10000} step={100} unit="ms" />
    <Segmented
      label="Job structure"
      bind:value={app.settings.lab.ticker.mode}
      options={[
        { value: 'stream', label: 'One job' },
        { value: 'jobs', label: 'Job per tick' },
      ]}
    />

    <details class="rounded-[10px] border border-line">
      <summary class="cursor-pointer px-3 py-2.5 text-sm font-semibold">Text and spacing</summary>
      <div class="space-y-4 border-t border-line p-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="ticker-font">Font</label>
            <select id="ticker-font" class="field mt-1.5" bind:value={app.settings.lab.ticker.text.font}>
              <option value="sans-serif">Sans-serif</option>
              <option value="serif">Serif</option>
              <option value="monospace">Monospace</option>
            </select>
          </div>
          <Segmented
            label="Align"
            bind:value={app.settings.lab.ticker.text.align}
            options={[
              { value: 'left', label: 'L' },
              { value: 'center', label: 'C' },
              { value: 'right', label: 'R' },
            ]}
          />
        </div>
        <Slider label="Font size" bind:value={app.settings.lab.ticker.text.size} min={12} max={300} unit="dots" hint="{(t.text.size / DOTS_PER_MM).toFixed(1)} mm" />
        <Slider label="Line height" bind:value={app.settings.lab.ticker.text.lineHeight} min={0.8} max={2.5} step={0.05} unit="×" />
        <Slider label="Padding" bind:value={app.settings.lab.ticker.text.padding} min={0} max={100} unit="dots" />
        <Toggle label="Bold" bind:checked={app.settings.lab.ticker.text.bold} />
        <Slider label="Blank rows after each tick" bind:value={app.settings.lab.ticker.gapRows} min={0} max={400} unit="rows" />
        <Slider label="Blank rows at the end" bind:value={app.settings.lab.ticker.tailRows} min={0} max={800} unit="rows" hint="160 rows (20 mm) clears the tear bar." />
        <Toggle
          label="Narrow raster frames (experimental)"
          hint="Send frames only as wide as the text, left aligned. Far less data per tick; untested on the printer."
          bind:checked={app.settings.lab.ticker.narrow}
        />
      </div>
    </details>

    {#if sample}
      <div>
        <div class="label mb-1.5">One tick</div>
        <div class="overflow-hidden rounded-[10px] border border-line bg-raised p-2">
          <BitmapCanvas bitmap={sample} label="Ticker sample" />
        </div>
      </div>
    {/if}

    <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
      <div><dt class="text-xs text-dim">Ticks</dt><dd class="font-mono text-[13px]">{ticks}</dd></div>
      <div><dt class="text-xs text-dim">Run time</dt><dd class="font-mono text-[13px]">≈ {formatDuration(totalSec)}</dd></div>
      <div><dt class="text-xs text-dim">Paper</dt><dd class="font-mono text-[13px]">{formatPaper(totalRows)}</dd></div>
      <div><dt class="text-xs text-dim">Per tick</dt><dd class="font-mono text-[13px]">{formatBytes(perTick.bytes)} · {formatDuration(perTick.seconds)}</dd></div>
    </dl>
    {#if tooSlow}
      <p class="rounded-[10px] border border-warn/40 bg-warn/10 p-3 text-sm">
        One tick takes about {formatDuration(perTick.seconds)} to send with the current pacing, longer than the {t.intervalMs} ms interval, so ticks
        will run late. Use a smaller font, narrow frames, a longer interval or a shorter chunk delay (Print → Job and transport).
      </p>
    {/if}

    <div class="flex items-center gap-3">
      <button type="button" class="btn btn-primary" disabled={!!blockedReason || ticks === 0} onclick={() => runTicker()}>Start ticker</button>
      {#if app.jobRunning}<button type="button" class="btn btn-danger" onclick={() => app.cancelPrint()}>Stop</button>{/if}
      {#if blockedReason && !app.jobRunning}<span class="text-xs text-dim">{blockedReason}</span>{/if}
    </div>
  </Section>

  <Section title="Parameter sweep" summary="{sweepKind.label} · {steps.length} jobs">
    <p class="text-sm text-dim">Print the same strip once per value, each as its own job with a caption, and compare the strips side by side.</p>
    <div>
      <div class="label mb-1.5">Vary</div>
      <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Vary">
        {#each SWEEP_KINDS as kind (kind.id)}
          <button
            type="button"
            role="radio"
            aria-checked={sw.kind === kind.id}
            class="min-h-9 rounded-full border px-3 text-sm font-semibold transition-colors {sw.kind === kind.id
              ? 'border-accent bg-accent text-on-accent'
              : 'border-line text-dim hover:text-fg'}"
            onclick={() => setSweepKind(kind.id)}
          >
            {kind.label}
          </button>
        {/each}
      </div>
      <p class="mt-1.5 text-xs text-dim">{sweepKind.hint}</p>
    </div>
    {#if sw.kind === 'repeat'}
      <Slider label="Copies" bind:value={app.settings.lab.sweep.repeatCount} min={1} max={50} />
    {:else}
      <div>
        <label class="label" for="sweep-values">Values{sweepKind.unit ? ` (${sweepKind.unit})` : ''}</label>
        <input id="sweep-values" class="field mt-1.5 font-mono" bind:value={app.settings.lab.sweep.values} placeholder="e.g. 0, 1, 2" />
      </div>
    {/if}
    <Segmented
      label="Strip content"
      bind:value={app.settings.lab.sweep.content}
      options={[
        { value: 'ladder', label: 'Gray ladder' },
        { value: 'current', label: 'Print tab source' },
      ]}
    />
    <Slider label="Strip height" bind:value={app.settings.lab.sweep.stripMm} min={0} max={200} unit="mm" hint="0 keeps the full content." />
    <Slider label="Pause between jobs" bind:value={app.settings.lab.sweep.pauseMs} min={0} max={10000} step={100} unit="ms" />
    <Toggle label="Caption above each strip" bind:checked={app.settings.lab.sweep.label} />

    <div class="flex items-center gap-3">
      <button type="button" class="btn btn-primary" disabled={!!blockedReason || steps.length === 0} onclick={() => runSweep()}>Run sweep</button>
      {#if blockedReason && !app.jobRunning}<span class="text-xs text-dim">{blockedReason}</span>{/if}
    </div>

    {#if sweepResults.rows.length}
      <table class="w-full text-left text-sm">
        <thead class="text-xs text-dim">
          <tr><th class="py-1 font-semibold">Step</th><th class="font-semibold">Result</th><th class="text-right font-semibold">Sent</th><th class="text-right font-semibold">Time</th></tr>
        </thead>
        <tbody class="divide-y divide-line border-t border-line font-mono text-[13px]">
          {#each sweepResults.rows as row, i (i)}
            <tr>
              <td class="py-1.5 font-sans">{row.label}</td>
              <td class={row.ok === null ? 'text-dim' : row.ok ? 'text-ok' : 'text-warn'}>{row.ok === null ? 'pending' : row.ok ? 'OK' : 'no ACK'}</td>
              <td class="text-right">{row.ok === null ? '' : formatBytes(row.sentBytes)}</td>
              <td class="text-right">{row.ok === null ? '' : formatDuration(row.durationMs / 1000)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </Section>
</div>
