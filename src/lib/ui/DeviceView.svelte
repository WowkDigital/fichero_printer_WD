<script lang="ts">
  import { app } from '../app.svelte';
  import { Cmd } from '../core/protocol';
  import Section from './Section.svelte';
  import Slider from './Slider.svelte';
  import Toggle from './Toggle.svelte';

  let feedMm = $state(10);

  const flags = $derived.by(() => {
    const s = app.status;
    if (!s) return [];
    return [
      { label: s.printing ? 'Printing' : 'Idle', tone: s.printing ? 'warn' : 'ok' },
      { label: s.coverOpen ? 'Cover open' : 'Cover closed', tone: s.coverOpen ? 'bad' : 'ok' },
      { label: s.noPaper ? 'No paper' : 'Paper loaded', tone: s.noPaper ? 'bad' : 'ok' },
      { label: s.overheated ? 'Overheated' : 'Temperature OK', tone: s.overheated ? 'bad' : 'ok' },
      ...(s.charging ? [{ label: 'Charging', tone: 'warn' }] : []),
    ];
  });

  const toneClass: Record<string, string> = {
    ok: 'border-ok/40 bg-ok/10 text-ok',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    bad: 'border-bad/40 bg-bad/10 text-bad',
  };
</script>

<div class="mx-auto max-w-2xl space-y-4 p-4">
  {#if !app.connected}
    <section class="card p-5 text-center">
      <div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
        <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 7l10 10-5 4V3l5 4L7 17" />
        </svg>
      </div>
      <h2 class="text-lg font-bold">Connect your printer</h2>
      <p class="mx-auto mt-1 max-w-sm text-sm text-dim">
        Turn the Fichero 6181 on and keep it close. Your browser will ask which device to pair.
      </p>

      {#if !app.bluetoothSupported}
        <p class="mt-4 rounded-[10px] border border-warn/40 bg-warn/10 p-3 text-left text-sm">
          This browser has no Web Bluetooth. Use Chrome, Edge, Opera or Samsung Internet on Android or desktop, over HTTPS.
          Firefox, Safari and all iOS browsers are not supported. You can still explore the app in demo mode.
        </p>
      {/if}

      <div class="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <button
          type="button"
          class="btn btn-primary sm:min-w-44"
          disabled={!app.bluetoothSupported || app.conn === 'connecting'}
          onclick={() => app.connect(false)}
        >
          {app.conn === 'connecting' ? 'Connecting…' : 'Connect via Bluetooth'}
        </button>
        <button type="button" class="btn" disabled={app.conn === 'connecting'} onclick={() => app.connect(true)}>
          Try demo mode
        </button>
      </div>
    </section>
  {:else}
    <section class="card p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-lg font-bold">{app.model || 'Unknown model'}</h2>
          <p class="truncate text-sm text-dim">{app.deviceName}</p>
        </div>
        {#if app.kind === 'mock'}
          <span class="shrink-0 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-xs font-semibold text-warn">Simulated</span>
        {/if}
      </div>

      <div class="mt-4">
        <div class="flex items-baseline justify-between text-sm">
          <span class="label">Battery</span>
          <span class="font-mono">{app.battery !== null ? `${app.battery}%` : '—'}</span>
        </div>
        <div class="mt-1.5 h-2.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Battery level" aria-valuenow={app.battery ?? 0} aria-valuemin={0} aria-valuemax={100}>
          <div
            class="h-full rounded-full transition-[width] {app.battery !== null && app.battery <= 15 ? 'bg-bad' : 'bg-ok'}"
            style:width="{app.battery ?? 0}%"
          ></div>
        </div>
      </div>

      <div class="mt-4">
        <div class="flex items-baseline justify-between">
          <span class="label">Hardware status</span>
          <span class="font-mono text-xs text-dim">
            {app.status ? `0x${app.status.raw.toString(16).padStart(2, '0').toUpperCase()} · 0b${app.status.raw.toString(2).padStart(8, '0')}` : 'no reply yet'}
          </span>
        </div>
        <div class="mt-2 flex flex-wrap gap-2">
          {#each flags as flag (flag.label)}
            <span class="rounded-full border px-2.5 py-1 text-xs font-semibold {toneClass[flag.tone]}">{flag.label}</span>
          {/each}
        </div>
      </div>

      <div class="mt-5 grid grid-cols-2 gap-2">
        <button type="button" class="btn" onclick={app.refresh}>Refresh</button>
        <button type="button" class="btn btn-danger" onclick={() => app.disconnect()}>Disconnect</button>
      </div>
    </section>

    <section class="card space-y-4 p-4">
      <h2 class="font-semibold">Manual control</h2>
      <Slider label="Feed distance" bind:value={feedMm} min={1} max={100} unit="mm" />
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-primary" disabled={app.jobRunning} onclick={() => app.feed(feedMm)}>Feed {feedMm} mm</button>
        <button type="button" class="btn" disabled={app.jobRunning} onclick={() => app.send(Cmd.formFeed())}>Form feed</button>
        <button type="button" class="btn" disabled={app.jobRunning} onclick={() => app.send(Cmd.wakeup())}>Wake up</button>
        <button type="button" class="btn" disabled={app.jobRunning} onclick={() => app.send(Cmd.enable())}>Enable head</button>
        <button type="button" class="btn btn-danger col-span-2" onclick={() => app.send(Cmd.stop())}>Stop print</button>
      </div>
    </section>
  {/if}

  <Section title="Session settings" summary="Heartbeat every {app.settings.heartbeatSec || '—'} s">
    <Slider label="Heartbeat interval" bind:value={() => app.settings.heartbeatSec, (v) => app.setHeartbeat(v)} min={0} max={60} unit="s" hint="Status and battery poll that keeps the link alive. 0 turns it off." />
    <Toggle label="Show all Bluetooth devices" bind:checked={app.settings.showAllDevices} hint="Skip the name filter (FICHERO, D11s_, PeriPage) in the device chooser." />
    <button type="button" class="btn btn-sm" onclick={() => app.resetSettings()}>Reset all settings to defaults</button>
  </Section>

  <p class="px-1 pb-2 text-xs text-dim">
    Low-level access: the session is exposed in the browser console as <code class="font-mono">printer</code> and
    <code class="font-mono">fichero</code>, e.g. <code class="font-mono">printer.sendRaw(fichero.parseHex('10 FF 40'))</code>.
  </p>
</div>
