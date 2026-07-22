<script setup lang="ts">
import { useI18n } from '../composables/useI18n'

const appIcon = './icon.png'
const { t } = useI18n()

defineProps<{
  sidebarCollapsed: boolean
  api: typeof window.fontral
}>()

defineEmits<{
  'toggle-sidebar': []
}>()
</script>

<template>
  <div class="titlebar">
    <img class="titlebar-mark" :src="appIcon" alt="" />
    <span>Fontral</span>
    <button
      class="sidebar-toggle"
      type="button"
      :aria-label="sidebarCollapsed ? t('ui.showSidebar') : t('ui.hideSidebar')"
      :data-tooltip="sidebarCollapsed ? t('ui.showSidebar') : t('ui.hideSidebar')"
      @click="$emit('toggle-sidebar')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path v-if="sidebarCollapsed" d="m14 6 6 6-6 6" />
        <path v-else d="m18 6-6 6 6 6" />
        <path d="M8 4v16" />
      </svg>
    </button>
    <div class="window-controls">
      <button type="button" :aria-label="t('ui.minimize')" @click="api.window.minimize()"><i class="minimize-icon"></i></button>
      <button type="button" :aria-label="t('ui.maximizeOrRestore')" @click="api.window.maximize()"><i class="maximize-icon"></i></button>
      <button class="close-button" type="button" :aria-label="t('ui.commonClose')" @click="api.window.close()"><i class="close-icon"></i></button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  position: relative;
  z-index: 1400;
  display: flex;
  align-items: center;
  gap: 9px;
  height: 42px;
  padding-left: 16px;
  background-color: var(--dark);
  color: var(--dark-ink);
  font-size: 13px;
  font-weight: 400;
  letter-spacing: .03em;
  -webkit-app-region: drag;
}

.titlebar-mark {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  object-fit: cover;
}

.window-controls {
  display: flex;
  align-self: stretch;
  margin-left: auto;
  -webkit-app-region: no-drag;
}

.window-controls button {
  position: relative;
  display: grid;
  place-items: center;
  width: 46px;
  border: 0;
  background: transparent;
  color: var(--dark-ink);
}

.window-controls button:hover {
  transition: background .2s ease;
  background: var(--titlebar-hover);
}

.window-controls .close-button:hover {
  background: var(--danger);
}

.window-controls button:focus-visible {
  outline: 2px solid var(--accent-lit);
  outline-offset: -3px;
}

.window-controls i {
  display: block;
  width: 10px;
  height: 10px;
}

.window-controls .minimize-icon {
  width: 12px;
  height: 1px;
  background: currentColor;
}

.maximize-icon {
  border: 1px solid currentColor;
}

.close-icon::before,
.close-icon::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 13px;
  height: 1px;
  background: currentColor;
  content: "";
  transform: translate(-50%, -50%) rotate(45deg);
}

.close-icon::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.sidebar-toggle {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-left: 8px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dark-ink);
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.sidebar-toggle:hover,
.sidebar-toggle:focus-visible {
  background: var(--titlebar-hover);
  outline: 0;
}

.sidebar-toggle svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}
</style>
