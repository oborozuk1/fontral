<script setup lang="ts">
import { useId } from 'vue'

type SegmentValue = string | number

defineProps<{
  modelValue: SegmentValue
  options: ReadonlyArray<{ label: string; value: SegmentValue }>
  ariaLabel: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: SegmentValue] }>()
const name = `segmented-control-${useId()}`
</script>

<template>
  <div class="segmented-control" role="radiogroup" :aria-label="ariaLabel">
    <label v-for="option in options" :key="String(option.value)" class="segmented-control__option"
      :class="{ 'segmented-control__option--selected': option.value === modelValue }">
      <input
        :name="name"
        type="radio"
        :value="option.value"
        :checked="option.value === modelValue"
        @change="emit('update:modelValue', option.value)"
      />
      <span>{{ option.label }}</span>
    </label>
  </div>
</template>

<style scoped>
.segmented-control {
  display: inline-grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  height: 40px;
  overflow: hidden;
  border: 1px solid var(--search-border);
  border-radius: var(--radius);
  background: var(--select-bg);
}

.segmented-control__option {
  position: relative;
  display: grid;
  min-width: 76px;
  min-height: 100%;
  place-items: center;
  padding: 0 11px;
  color: var(--select-option-ink);
  font-family: inherit;
  font-size: 13px;
  font-weight: 400;
  cursor: pointer;
  transition: background var(--ease), color var(--ease);
}

.segmented-control__option + .segmented-control__option {
  border-left: 1px solid var(--search-border);
}

.segmented-control__option input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.segmented-control__option:hover {
  background: var(--select-hover);
  color: var(--accent-ink);
}

.segmented-control__option--selected {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.segmented-control__option input:focus-visible + span {
  outline: 2px solid var(--accent-lit);
  outline-offset: 3px;
}

@media (max-width: 780px) {
  .segmented-control {
    width: 100%;
  }
}
</style>
