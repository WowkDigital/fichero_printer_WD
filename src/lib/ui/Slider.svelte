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
  <div class="flex items-center justify-between gap-3">
    <label class="label" for={id}>{label}</label>
    <div class="flex items-center gap-1.5">
      <input
        class="field !min-h-9 !w-20 !py-1 text-right font-mono !text-[15px]"
        type="number"
        inputmode="decimal"
        {min}
        {max}
        {step}
        {value}
        onchange={commit}
        aria-label="{label} value"
      />
      {#if unit}<span class="w-7 text-xs text-dim">{unit}</span>{/if}
    </div>
  </div>
  <input {id} type="range" {min} {max} {step} bind:value />
  {#if hint}<p class="text-xs text-dim">{hint}</p>{/if}
</div>
