<script setup lang="ts">
defineProps<{
  title: string
}>()

const open = defineModel<boolean>('open', { default: true })

function toggle() {
  open.value = !open.value
}
</script>

<template>
  <div class="detail-section" :class="{ open }">
    <button type="button" class="detail-section-toggle" :aria-expanded="open" @click="toggle">
      <span>{{ title }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
    </button>
    <div class="detail-section-collapse" :aria-hidden="!open">
      <div class="detail-section-collapse-inner">
        <div class="detail-section-body">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-section {
  min-width: 0;
}

.detail-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-white);
  color: var(--ink-2);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: border-color .18s ease, border-radius .18s ease, background .18s ease, color .18s ease;
}

.detail-section.open .detail-section-toggle {
  border-radius: var(--radius) var(--radius) 0 0;
  border-bottom-color: var(--line-soft);
  background: var(--bg-soft);
}

.detail-section-toggle:hover,
.detail-section-toggle:focus-visible {
  border-color: var(--detail-section-border);
  background: var(--detail-section-bg);
  color: var(--accent-ink);
  outline: 0;
}

.detail-section-toggle svg {
  width: 16px;
  height: 16px;
  flex: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
  transition: transform .2s ease;
}

.detail-section.open .detail-section-toggle svg {
  transform: rotate(180deg);
}

.detail-section-collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows .22s ease, opacity .18s ease;
}

.detail-section.open .detail-section-collapse {
  grid-template-rows: 1fr;
  opacity: 1;
}

.detail-section-collapse-inner {
  min-height: 0;
  overflow: hidden;
}

.detail-section-body {
  padding: 12px;
  border: 1px solid var(--line);
  border-top: 0;
  border-radius: 0 0 var(--radius) var(--radius);
  background: var(--bg-white);
}

.detail-section-body > .muted {
  margin: 0;
}
</style>
