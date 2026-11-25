<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    summary?: string;
    open?: boolean;
    children: Snippet;
  }
  let { title, summary = '', open = $bindable(false), children }: Props = $props();
</script>

<details class="card group" bind:open>
  <summary class="flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
    <span class="min-w-0">
      <span class="block font-semibold">{title}</span>
      {#if summary}<span class="block truncate text-xs text-dim">{summary}</span>{/if}
    </span>
    <svg class="h-5 w-5 shrink-0 text-dim transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 8l5 5 5-5" />
    </svg>
  </summary>
  <div class="space-y-4 border-t border-line px-4 py-4">
    {@render children()}
  </div>
</details>
