<script lang="ts">
  import { app, type Tab } from './lib/app.svelte';
  import DeviceView from './lib/ui/DeviceView.svelte';
  import PrintView from './lib/ui/PrintView.svelte';
  import PacketsView from './lib/ui/PacketsView.svelte';

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'device', label: 'Device', icon: 'M7 8V4h10v4M6 8h12a2 2 0 0 1 2 2v6h-3v4H7v-4H4v-6a2 2 0 0 1 2-2zM9 14h6' },
    { id: 'print', label: 'Print', icon: 'M4 5h16v14H4zM4 15l4.5-4.5 3.5 3.5 2.5-2.5L20 17M9 9h.01' },
    { id: 'packets', label: 'Packets', icon: 'M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3' },
  ];

  // Persist settings whenever any of them changes.
  $effect(() => {
    JSON.stringify(app.settings);
    app.saveSettings();
  });

  const statusLabel = $derived(
    app.conn === 'connecting' ? 'Connecting…' : app.connected ? (app.model || app.deviceName) : 'Not connected',
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
        {#if tab.id === 'print' && app.jobRunning}
          <span class="absolute right-[calc(50%-18px)] top-2 h-2 w-2 animate-pulse rounded-full bg-accent"></span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4 pt-[env(safe-area-inset-top)]">
      <h1 class="py-3 text-base font-bold tracking-tight">Fichero <span class="text-accent">Lab</span></h1>
      <button
        type="button"
        class="flex min-h-9 min-w-0 items-center gap-2 rounded-full border border-line bg-raised px-3 text-sm"
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
    </header>

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
      {:else}
        <PacketsView />
      {/if}
    </main>
  </div>
</div>
