<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    hint?: string;
  }
  let { label, value = $bindable(), min, max, step = 1, unit = '', hint = '' }: Props = $props();
  const id = $props.id();

  function commit(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const next = Number(input.value);
    if (input.value !== '' && Number.isFinite(next)) value = Math.min(max, Math.max(min, next));
    input.value = String(value);
  }
</script>

<div>
  <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-2">
    <label class="label break-words" for={id}>{label}</label>
    <input {id} class="min-w-0" type="range" {min} {max} {step} bind:value />
    <div class="flex items-center gap-1">
      <input
        class="field !min-h-9 !w-17 !px-1 !py-1 text-right font-mono !text-[14px]"
        type="number"
        inputmode="decimal"
        {min}
        {max}
        {step}
        {value}
        onchange={commit}
        aria-label="{label} value"
      />
      {#if unit}<span class="text-xs text-dim">{unit}</span>{/if}
    </div>
  </div>
  {#if hint}<p class="text-xs text-dim">{hint}</p>{/if}
</div>
