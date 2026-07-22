<script setup lang="ts">
withDefaults(defineProps<{
  min?: number
  max?: number
  step?: number
  label?: string
  ariaLabel?: string
  unit?: string
  showValue?: boolean
  /** Homepage keeps value on the right; settings rows may put it on the left for alignment. */
  valuePosition?: 'left' | 'right'
}>(), {
  min: 0,
  max: 100,
  step: 1,
  unit: '',
  showValue: true,
  valuePosition: 'right',
})

const model = defineModel<number>({ required: true })

const emit = defineEmits<{
  input: []
  change: []
}>()
</script>

<template>
  <label
    class="range-slider"
    :class="{
      'range-slider--with-label': !!label,
      'range-slider--value-left': valuePosition === 'left',
    }"
  >
    <span v-if="label" class="range-slider__label">{{ label }}</span>
    <output
      v-if="showValue && valuePosition === 'left'"
      class="range-slider__value"
    >{{ model }}{{ unit ? ` ${unit}` : '' }}</output>
    <input
      v-model.number="model"
      class="range-slider__input"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :aria-label="ariaLabel || label"
      @input="emit('input')"
      @change="emit('change')"
    />
    <output
      v-if="showValue && valuePosition === 'right'"
      class="range-slider__value"
    >{{ model }}{{ unit ? ` ${unit}` : '' }}</output>
  </label>
</template>

<style scoped>
.range-slider {
  display: grid;
  flex: none;
  grid-template-columns: 120px 3.25em;
  align-items: center;
  column-gap: 10px;
  color: var(--ink-3);
  font-size: 12px;
  white-space: nowrap;
}

.range-slider--value-left {
  grid-template-columns: 3.25em 120px;
}

.range-slider--with-label {
  grid-template-columns: auto 120px 3.25em;
  margin-top: 12px;
}

.range-slider--with-label.range-slider--value-left {
  grid-template-columns: auto 3.25em 120px;
}

.range-slider__label {
  min-width: 0;
}

.range-slider__input {
  width: 120px;
  height: 16px;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.range-slider__input::-webkit-slider-runnable-track {
  height: 5px;
  border-radius: 99px;
  background: var(--slider-track);
}

.range-slider__input::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -4.5px;
  border: 2px solid var(--bg-soft);
  border-radius: 50%;
  appearance: none;
  background: var(--accent);
  box-shadow: var(--shadow-thumb);
  transition: transform var(--ease), box-shadow var(--ease);
}

.range-slider__input:hover::-webkit-slider-thumb,
.range-slider__input:active::-webkit-slider-thumb {
  transform: scale(var(--slider-thumb-hover-scale));
  box-shadow: var(--shadow-thumb-active);
}

.range-slider__input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 99px;
}

.range-slider__value {
  min-width: 0;
  color: var(--ink-3);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-align: right;
}
</style>
