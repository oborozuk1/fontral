<script setup lang="ts">
withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset'
    label?: string
    tooltip?: string
    tooltipPlacement?: 'top' | 'bottom' | 'left' | 'right'
    disabled?: boolean
    active?: boolean
    busy?: boolean
    variant?: 'surface' | 'ghost' | 'dark' | 'plain' | 'primary' | 'danger' | 'neutral' | 'secondary'
    size?: 'sm' | 'md' | 'lg'
  }>(),
  {
    type: 'button',
    disabled: false,
    active: false,
    busy: false,
    variant: 'surface',
    size: 'md'
  }
)
</script>

<template>
  <button
    class="app-button"
    :class="[
      `app-button--${variant}`,
      `app-button--${size}`,
      { 'is-active': active, 'is-busy': busy }
    ]"
    :type="type"
    :disabled="disabled || busy"
    :aria-label="label"
    :aria-busy="busy || undefined"
    :data-tooltip="tooltip || undefined"
    :data-tooltip-placement="tooltipPlacement || undefined"
  >
    <slot />
  </button>
</template>

<style scoped>
.app-button {
  display: grid;
  place-items: center;
  flex: none;
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background var(--ease), border-color var(--ease), color var(--ease), opacity var(--ease);
}

.app-button:focus-visible {
  outline: 2px solid var(--accent-lit);
  outline-offset: 2px;
}

.app-button:disabled {
  cursor: default;
  opacity: .45;
}

.app-button.is-busy:disabled {
  cursor: wait;
  opacity: .65;
}

.app-button :deep(svg) {
  display: block;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.app-button--sm {
  width: 28px;
  height: 28px;
  border-radius: 6px;
}

.app-button--sm :deep(svg) {
  width: 15px;
  height: 15px;
}

.app-button--md { width: 34px; height: 34px; }
.app-button--lg { width: 38px; height: 38px; }

.app-button--surface {
  border-color: var(--line-2);
  background: var(--bg-white);
  color: var(--ink-3);
}

.app-button--surface:hover:not(:disabled),
.app-button--surface:focus-visible:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-ink);
}

.app-button--surface.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.app-button--ghost {
  border-color: transparent;
  background: transparent;
  color: var(--ghost-ink);
}

.app-button--ghost:hover:not(:disabled),
.app-button--ghost:focus-visible:not(:disabled) {
  border-color: var(--line-2);
  background: var(--bg-white);
  color: var(--accent-ink);
}

.app-button--dark {
  border-color: var(--dark-line);
  background: transparent;
  color: var(--dark-muted);
}

.app-button--dark:hover:not(:disabled),
.app-button--dark:focus-visible:not(:disabled) {
  border-color: var(--button-dark-hover-border);
  background: var(--dark-2);
  color: var(--dark-ink);
}

.app-button--dark:active:not(:disabled) {
  background: var(--dark-3);
}

.app-button--plain {
  border-color: transparent;
  background: transparent;
  color: var(--dark-muted);
  border-radius: 4px;
}

.app-button--plain:hover:not(:disabled),
.app-button--plain:focus-visible:not(:disabled) {
  background: var(--dark-3);
  color: var(--dark-ink);
  outline: 0;
}

.app-button--plain:disabled {
  opacity: .35;
}

/* ---- Text-button variants (auto-width, padded) ---- */

.app-button--primary,
.app-button--danger,
.app-button--neutral,
.app-button--secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: auto;
  height: auto;
  padding: 8px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.2;
  white-space: nowrap;
  border-radius: var(--radius-sm);
}

.app-button--primary {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
}

.app-button--primary:hover:not(:disabled),
.app-button--primary:focus-visible:not(:disabled) {
  background: var(--accent-hover);
}

.app-button--danger {
  border-color: transparent;
  background: var(--danger);
  color: #fff;
}

.app-button--danger:hover:not(:disabled),
.app-button--danger:focus-visible:not(:disabled) {
  background: var(--danger-hover);
}

.app-button--neutral {
  border-color: transparent;
  background: var(--modal-cancel-bg);
  color: var(--modal-cancel-ink);
}

.app-button--neutral:hover:not(:disabled),
.app-button--neutral:focus-visible:not(:disabled) {
  background: var(--modal-cancel-hover);
}

.app-button--secondary {
  border-color: var(--line-2);
  background: var(--settings-secondary-bg);
  color: var(--modal-cancel-ink);
  font-size: 12px;
  font-weight: 600;
}

.app-button--secondary:hover:not(:disabled),
.app-button--secondary:focus-visible:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-ink);
}
</style>
