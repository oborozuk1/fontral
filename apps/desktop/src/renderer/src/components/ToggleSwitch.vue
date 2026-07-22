<script setup lang="ts">
withDefaults(defineProps<{
  label?: string
  description?: string
  ariaLabel?: string
  ready?: boolean
}>(), {
  ready: true,
})

const model = defineModel<boolean>({ required: true })
</script>

<template>
  <label class="toggle-switch" :class="{ 'toggle-switch--ready': ready }">
    <span v-if="label || description || $slots.default" class="toggle-switch__copy">
      <span v-if="label" class="toggle-switch__label">{{ label }}</span>
      <small v-if="description" class="toggle-switch__desc">{{ description }}</small>
      <slot />
    </span>
    <input
      v-model="model"
      type="checkbox"
      class="toggle-switch__input"
      :aria-label="ariaLabel || label"
    />
  </label>
</template>

<style scoped>
.toggle-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 14px;
  cursor: pointer;
}

.toggle-switch:last-child {
  margin-bottom: 0;
}

.toggle-switch__copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.toggle-switch__label {
  color: var(--ink);
  font-size: 13px;
  line-height: 1.35;
}

.toggle-switch__desc {
  color: var(--ink-5);
  font-size: 11px;
  line-height: 1.45;
}

.toggle-switch__input {
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  margin: 0;
  border: 0;
  border-radius: 99px;
  appearance: none;
  background: var(--control-track);
  cursor: pointer;
}

.toggle-switch__input::after {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--bg-white);
  content: "";
}

.toggle-switch--ready .toggle-switch__input {
  transition: background var(--ease), box-shadow var(--ease);
}

.toggle-switch--ready .toggle-switch__input::after {
  transition: transform var(--ease);
}

.toggle-switch:hover .toggle-switch__input:not(:checked) {
  background: var(--control-track-hover);
}

.toggle-switch:hover .toggle-switch__input:checked {
  background: var(--control-track-on-hover);
}

.toggle-switch__input:checked {
  background: var(--accent);
}

.toggle-switch__input:checked::after {
  transform: translateX(14px);
}

.toggle-switch__input:focus-visible {
  box-shadow: var(--focus-ring);
}
</style>
