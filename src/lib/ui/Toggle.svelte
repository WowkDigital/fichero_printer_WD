<script lang="ts">
  interface Props {
    label: string;
    checked: boolean;
    hint?: string;
    mono?: string;
  }
  let { label, checked = $bindable(), hint = '', mono = '' }: Props = $props();
</script>

<label class="flex min-h-11 cursor-pointer items-center justify-between gap-3 py-1">
  <span class="min-w-0">
    <span class="block text-[15px]">{label}</span>
    {#if mono}<span class="block font-mono text-xs text-dim">{mono}</span>{/if}
    {#if hint}<span class="block text-xs text-dim">{hint}</span>{/if}
  </span>
  <span class="relative inline-flex shrink-0">
    <input type="checkbox" class="peer sr-only" bind:checked />
    <span class="h-7 w-12 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"></span>
    <span class="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"></span>
  </span>
</label>
