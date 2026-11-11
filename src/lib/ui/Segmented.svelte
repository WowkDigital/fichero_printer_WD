<script lang="ts" generics="T extends string | number">
  interface Props {
    label?: string;
    value: T;
    options: { value: T; label: string }[];
  }
  let { label = '', value = $bindable(), options }: Props = $props();
</script>

<div>
  {#if label}<div class="label mb-1.5">{label}</div>{/if}
  <div class="flex rounded-[10px] border border-line bg-bg p-1" role="radiogroup" aria-label={label || undefined}>
    {#each options as option (option.value)}
      <button
        type="button"
        role="radio"
        aria-checked={value === option.value}
        class="min-h-9 flex-1 rounded-[7px] px-2 text-sm font-semibold transition-colors {value === option.value
          ? 'bg-accent text-on-accent'
          : 'text-dim hover:text-fg'}"
        onclick={() => (value = option.value)}
      >
        {option.label}
      </button>
    {/each}
  </div>
</div>
