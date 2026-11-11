<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../app.svelte';
  import { parseHex, toAscii, toHex } from '../core/bytes';
  import type { Packet } from '../core/printer';
  import Segmented from './Segmented.svelte';

  const PAGE = 300;
  const PREVIEW_BYTES = 24;

  let filter = $state<'all' | 'tx' | 'rx'>('all');
  let hideRaster = $state(true);
  let follow = $state(true);
  let limit = $state(PAGE);
  let expanded = $state<number | null>(null);
  let input = $state('');
  let inputError = $state('');
  let history = $state<string[]>([]);
  let list = $state<HTMLDivElement>();

  const presets = [
    { label: 'Status', hex: '10 FF 40' },
    { label: 'Battery', hex: '10 FF 50 F1' },
    { label: 'Model', hex: '10 FF 20 F0' },
    { label: 'Wakeup', hex: '00 00 00 00 00 00 00 00 00 00 00 00' },
    { label: 'Enable', hex: '10 FF FE 01' },
    { label: 'Stop', hex: '10 FF FE 45' },
    { label: 'Feed 10 mm', hex: '1B 4A 50' },
  ];

  const filtered = $derived.by(() => {
    app.packetTick;
    return app.packets.filter(
      (p) => (filter === 'all' || p.dir === filter) && !(hideRaster && p.dir === 'tx' && p.note?.startsWith('Raster data')),
    );
  });
  const visible = $derived(filtered.slice(-limit));

  // Keep the newest packet in view while following.
  $effect(() => {
    visible.length;
    app.packetTick;
    if (follow && list) void tick().then(() => list && (list.scrollTop = list.scrollHeight));
  });

  function onScroll() {
    if (!list) return;
    follow = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  }

  function time(p: Packet) {
    const d = new Date(p.wall);
    const pad = (n: number, l = 2) => String(n).padStart(l, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }

  async function send() {
    inputError = '';
    let bytes: Uint8Array;
    try {
      bytes = parseHex(input);
    } catch (err) {
      inputError = (err as Error).message;
      return;
    }
    history = [input.trim(), ...history.filter((h) => h !== input.trim())].slice(0, 8);
    follow = true;
    await app.send(bytes);
  }

  function exportLog() {
    const lines = app.packets.map((p) => `${time(p)}\t${p.dir.toUpperCase()}\t${p.data.length}\t${toHex(p.data)}\t${p.note ?? ''}`);
    const blob = new Blob([`time\tdir\tbytes\thex\tnote\n${lines.join('\n')}\n`], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fichero-packets-${new Date().toISOString().replace(/[:.]/g, '-')}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
  <!-- Toolbar -->
  <div class="shrink-0 space-y-2 border-b border-line p-3">
    <div class="flex items-center gap-2">
      <div class="min-w-0 flex-1">
        <Segmented
          bind:value={filter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'tx', label: 'TX' },
            { value: 'rx', label: 'RX' },
          ]}
        />
      </div>
      <button type="button" class="btn btn-sm" disabled={app.packets.length === 0} onclick={exportLog}>Export</button>
      <button type="button" class="btn btn-sm btn-danger" disabled={app.packets.length === 0} onclick={() => app.clearPackets()}>Clear</button>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-dim">
      <span class="font-mono">
        <span class="text-tx">TX {app.txBytes.toLocaleString('en')} B</span> ·
        <span class="text-rx">RX {app.rxBytes.toLocaleString('en')} B</span> ·
        {filtered.length} shown
      </span>
      <span class="flex items-center gap-4">
        <label class="flex min-h-8 cursor-pointer items-center gap-1.5">
          <input type="checkbox" class="h-4 w-4 accent-(--c-accent)" bind:checked={hideRaster} /> Hide raster data
        </label>
        <label class="flex min-h-8 cursor-pointer items-center gap-1.5">
          <input type="checkbox" class="h-4 w-4 accent-(--c-accent)" bind:checked={app.settings.logRasterData} /> Record raster data
        </label>
      </span>
    </div>
  </div>

  <!-- Log -->
  <div bind:this={list} onscroll={onScroll} class="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="log" aria-label="Packet log">
    {#if filtered.length === 0}
      <div class="flex h-full items-center justify-center p-6 text-center text-sm text-dim">
        {app.packets.length === 0 ? 'No packets yet. Connect a printer or send a command below.' : 'No packets match the current filter.'}
      </div>
    {:else}
      {#if filtered.length > limit}
        <button type="button" class="btn btn-sm mx-auto my-2 flex" onclick={() => ((follow = false), (limit += PAGE))}>
          Show {Math.min(PAGE, filtered.length - limit)} older
        </button>
      {/if}
      <ul class="divide-y divide-line/60">
        {#each visible as p (p.id)}
          {@const open = expanded === p.id}
          <li>
            <button
              type="button"
              class="block w-full px-3 py-2 text-left hover:bg-raised/60"
              aria-expanded={open}
              onclick={() => (expanded = open ? null : p.id)}
            >
              <span class="flex items-center gap-2 text-xs">
                <span class="w-7 rounded px-1 py-0.5 text-center font-mono font-bold {p.dir === 'tx' ? 'bg-tx/15 text-tx' : 'bg-rx/15 text-rx'}">
                  {p.dir.toUpperCase()}
                </span>
                <span class="font-mono text-dim">{time(p)}</span>
                <span class="font-mono text-dim">{p.data.length} B</span>
                {#if p.note}<span class="min-w-0 truncate font-semibold">{p.note}</span>{/if}
              </span>
              <span class="mt-1 block font-mono text-[13px] leading-5 {open ? 'break-all' : 'truncate'}">
                {open ? toHex(p.data) : toHex(p.data.subarray(0, PREVIEW_BYTES)) + (p.data.length > PREVIEW_BYTES ? ' …' : '')}
              </span>
              {#if open}
                <span class="mt-1 block break-all font-mono text-xs leading-5 text-dim">ASCII: {toAscii(p.data)}</span>
                <span class="mt-0.5 block font-mono text-xs text-dim">t = {p.t.toFixed(1)} ms since session start</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if !follow && filtered.length > 0}
    <div class="pointer-events-none relative h-0">
      <button
        type="button"
        class="btn btn-sm btn-primary pointer-events-auto absolute bottom-2 left-1/2 -translate-x-1/2 shadow-lg"
        onclick={() => {
          follow = true;
          if (list) list.scrollTop = list.scrollHeight;
        }}
      >
        Jump to latest
      </button>
    </div>
  {/if}

  <!-- Raw command console -->
  <form
    class="shrink-0 space-y-2 border-t border-line bg-panel p-3"
    onsubmit={(e) => {
      e.preventDefault();
      void send();
    }}
  >
    <div class="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none]">
      {#each presets as preset (preset.label)}
        <button type="button" class="btn btn-sm shrink-0" onclick={() => ((input = preset.hex), (inputError = ''))}>{preset.label}</button>
      {/each}
      {#each history as item (item)}
        <button type="button" class="btn btn-sm max-w-40 shrink-0 font-mono" title={item} onclick={() => (input = item)}>
          <span class="truncate">{item}</span>
        </button>
      {/each}
    </div>
    <div class="flex gap-2">
      <input
        class="field min-w-0 flex-1 font-mono"
        bind:value={input}
        placeholder="Hex bytes, e.g. 10 FF 40"
        aria-label="Raw hex command"
        aria-invalid={inputError !== ''}
        autocapitalize="characters"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
      />
      <button type="submit" class="btn btn-primary" disabled={!app.connected || input.trim() === ''}>Send</button>
    </div>
    {#if inputError}
      <p class="text-xs text-bad" role="alert">{inputError}</p>
    {:else if !app.connected}
      <p class="text-xs text-dim">Connect a printer to send raw commands.</p>
    {/if}
  </form>
</div>
