<script lang="ts">
  import { app, type Tab } from './lib/app.svelte';
  import { OUTPUT_MODES } from './lib/lab/config';
  import DeviceView from './lib/ui/DeviceView.svelte';
  import { formatBytes, formatDuration, formatPaper } from './lib/ui/format';
  import GalleryView from './lib/ui/GalleryView.svelte';
  import LabView from './lib/ui/LabView.svelte';
  import PacketsView from './lib/ui/PacketsView.svelte';
  import PrintView from './lib/ui/PrintView.svelte';

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'device', label: 'Device', icon: 'M7 8V4h10v4M6 8h12a2 2 0 0 1 2 2v6h-3v4H7v-4H4v-6a2 2 0 0 1 2-2zM9 14h6' },
    { id: 'print', label: 'Print', icon: 'M4 5h16v14H4zM4 15l4.5-4.5 3.5 3.5 2.5-2.5L20 17M9 9h.01' },
    { id: 'gallery', label: 'Gallery', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
    { id: 'lab', label: 'Lab', icon: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9' },
    { id: 'packets', label: 'Packets', icon: 'M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3' },
  ];

  // Persist settings whenever any of them changes.
  $effect(() => {
    JSON.stringify(app.settings);
    app.saveSettings();
  });

  // Keep the 1-bit bitmap current on every tab, so Print in the header always prints what the Print tab shows.
  $effect(() => {
    const { tone, source, raster } = app.settings;
    JSON.stringify([tone, source, raster.headDots]);
    app.image;
    app.scheduleRender();
  });

  const statusLabel = $derived(
    app.conn === 'connecting' ? 'Connecting…' : app.connected ? (app.model || app.deviceName) : 'Not connected',
  );

  const mode = $derived(OUTPUT_MODES.find((m) => m.id === app.settings.output)!);
  const needsPrinter = $derived(app.settings.output !== 'simulate' && !app.connected);
  const printLabel = $derived(app.settings.output === 'print' ? 'Print' : app.settings.output === 'blank' ? 'Run blank' : 'Run sim');

  const progressPct = $derived(
    app.jobProgress && app.jobProgress.totalBytes > 0 ? (app.jobProgress.sentBytes / app.jobProgress.totalBytes) * 100 : 0,
  );
  const throughput = $derived(
    app.jobProgress && app.jobProgress.elapsedMs > 0 ? (app.jobProgress.sentBytes / app.jobProgress.elapsedMs) * 1000 : 0,
  );
  const phaseLabel = $derived(
    !app.jobProgress
      ? 'Running…'
      : app.jobProgress.phase === 'finish'
        ? 'Finishing…'
        : app.jobProgress.phase === 'setup'
          ? 'Starting…'
          : `Sending ${progressPct.toFixed(0)}%`,
  );
</script>

<div class="flex h-full flex-col md:flex-row">
  <!-- Navigation: bottom bar on phones, side rail on wider screens -->
  <nav
    class="order-last flex shrink-0 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:order-first md:w-20 md:flex-col md:border-t-0 md:border-r md:pt-3 md:pb-0"
    aria-label="Main"
  >
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        class="relative flex min-h-15 flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors md:min-h-16 md:flex-none {app.tab ===
        tab.id
          ? 'text-accent'
          : 'text-dim hover:text-fg'}"
        aria-current={app.tab === tab.id ? 'page' : undefined}
        onclick={() => (app.tab = tab.id)}
      >
        <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d={tab.icon} />
        </svg>
        {tab.label}
      </button>
    {/each}
  </nav>

  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <header class="relative flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 pt-[env(safe-area-inset-top)] sm:gap-3 sm:px-4">
      <h1 class="hidden py-3 text-base font-bold tracking-tight sm:block">Fichero <span class="text-accent">Lab</span></h1>
      <button
        type="button"
        class="my-2.5 flex min-h-9 min-w-0 items-center gap-2 rounded-full border border-line bg-raised px-3 text-sm sm:ml-auto"
        onclick={() => (app.tab = 'device')}
        aria-label="Connection status: {statusLabel}"
      >
        <span
          class="h-2.5 w-2.5 shrink-0 rounded-full {app.connected ? 'bg-ok' : app.conn === 'connecting' ? 'animate-pulse bg-warn' : 'bg-dim'}"
        ></span>
        <span class="truncate">{statusLabel}</span>
        {#if app.connected && app.battery !== null}
          <span class="shrink-0 font-mono text-xs text-dim">{app.battery}%</span>
        {/if}
      </button>

      <div class="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
        <label class="sr-only" for="output-mode">Output</label>
        <select
          id="output-mode"
          class="field !min-h-9 !w-auto !py-1 !pr-7 !pl-2 !text-sm {app.settings.output !== 'print' ? '!border-accent !text-accent' : ''}"
          bind:value={app.settings.output}
          disabled={app.jobRunning}
          title={mode.hint}
        >
          {#each OUTPUT_MODES as m (m.id)}
            <option value={m.id}>{m.label}</option>
          {/each}
        </select>
        {#if app.jobRunning}
          <button type="button" class="btn btn-danger btn-sm min-w-20" onclick={() => app.cancelPrint()}>Cancel</button>
        {:else if needsPrinter}
          <button type="button" class="btn btn-primary btn-sm min-w-20" onclick={() => (app.tab = 'device')}>Connect</button>
        {:else}
          <button
            type="button"
            class="btn btn-primary btn-sm min-w-20"
            disabled={!app.bitmap || app.rendering}
            title={app.bitmap ? `${mode.hint} Prints the Print tab source.` : 'Nothing to print yet'}
            onclick={() => app.print()}
          >
            {printLabel}
          </button>
        {/if}
      </div>

      {#if app.jobRunning && app.jobProgress?.phase === 'data'}
        <div class="absolute inset-x-0 bottom-0 h-0.5 bg-raised">
          <div class="h-full bg-accent transition-[width]" style:width="{progressPct}%"></div>
        </div>
      {/if}
    </header>

    {#if app.jobRunning}
      <div class="flex shrink-0 items-center gap-3 border-b border-line bg-accent/10 px-4 py-2 text-sm" aria-live="polite">
        <span class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent"></span>
        <div class="min-w-0 flex-1">
          <span class="font-semibold">{app.jobLabel}</span>
          {#if app.settings.output !== 'print'}<span class="text-accent"> · {mode.short}</span>{/if}
          {#if app.jobProgress}<span class="text-dim"> · {phaseLabel}</span>{/if}
          <span class="block truncate font-mono text-xs text-dim">
            {#if app.jobDetail}{app.jobDetail}{/if}
            {#if app.jobProgress}
              {app.jobDetail ? '·' : ''} {formatBytes(app.jobProgress.sentBytes)} / {formatBytes(app.jobProgress.totalBytes)}
              {#if throughput > 0}· {formatBytes(Math.round(throughput))}/s{/if}
            {/if}
          </span>
        </div>
      </div>
    {:else if app.lastRun}
      {@const r = app.lastRun}
      <div class="flex shrink-0 items-start gap-3 border-b border-line px-4 py-2 text-sm {r.cancelled || !r.ok ? 'bg-warn/10' : 'bg-ok/10'}">
        <div class="min-w-0 flex-1">
          <span class="font-semibold {r.cancelled || !r.ok ? 'text-warn' : 'text-ok'}">
            {r.label}{r.mode !== 'print' ? ` (${OUTPUT_MODES.find((m) => m.id === r.mode)?.short})` : ''}: {r.cancelled ? 'cancelled' : r.detail}
          </span>
          <span class="block truncate font-mono text-xs text-dim">
            {formatBytes(r.sentBytes)} in {formatDuration(r.durationMs / 1000)} · paper {formatPaper(r.paperRows)}
          </span>
        </div>
        <button type="button" class="-my-1 min-h-9 shrink-0 px-2 font-semibold text-dim" onclick={() => (app.lastRun = null)}>Dismiss</button>
      </div>
    {/if}

    {#if app.error}
      <div class="flex shrink-0 items-start gap-3 border-b border-bad/40 bg-bad/10 px-4 py-2.5 text-sm" role="alert">
        <span class="min-w-0 flex-1 break-words">{app.error}</span>
        <button type="button" class="-my-1 min-h-9 shrink-0 px-2 font-semibold text-bad" onclick={() => (app.error = null)}>Dismiss</button>
      </div>
    {/if}

    <main class="min-h-0 flex-1 {app.tab === 'packets' ? 'flex flex-col' : 'overflow-y-auto'}">
      {#if app.tab === 'device'}
        <DeviceView />
      {:else if app.tab === 'print'}
        <PrintView />
      {:else if app.tab === 'gallery'}
        <GalleryView />
      {:else if app.tab === 'lab'}
        <LabView />
      {:else}
        <PacketsView />
      {/if}
    </main>
  </div>
</div>
