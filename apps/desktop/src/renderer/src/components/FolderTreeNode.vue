<script setup lang="ts">
import type { FolderNode } from '../composables/useLibrary'
import AppButton from './AppButton.vue'
import CollapseTransition from './CollapseTransition.vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

const props = defineProps<{
  node: FolderNode
  rootId: number
  depth: number
  enterIndex?: number
  selectedPath: string | null
  isExpanded: (path: string) => boolean
}>()

const emit = defineEmits<{
  select: [rootId: number, path: string]
  toggle: [path: string]
  'toggle-visibility': [rootId: number, node: FolderNode]
}>()

function onToggle(event: MouseEvent) {
  event.stopPropagation()
  emit('toggle', props.node.path)
}
</script>

<template>
  <div class="folder-node" :class="{ 'folder-node--entering': enterIndex !== undefined }" :style="{ '--depth': depth, '--folder-index': enterIndex ?? 0 }">
    <div class="folder-row" :class="{ selected: selectedPath === node.path }">
      <button
        type="button"
        class="folder-twist"
        :class="{ placeholder: !node.children.length, open: isExpanded(node.path) }"
        :aria-label="isExpanded(node.path) ? t('ui.collapseSubfolders') : t('ui.expandSubfolders')"
        @click="node.children.length ? onToggle($event) : undefined"
      >
        <svg v-if="node.children.length" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
      <button
        type="button"
        class="folder-label"
        :data-tooltip="node.path"
        :data-folder-path="node.path"
        :data-root-id="rootId"
        @click="emit('select', rootId, node.path)"
      >{{ node.note || node.name }}</button>
      <AppButton
        variant="plain"
        size="sm"
        :label="node.visible ? t('ui.hideFolderFonts') : t('ui.showFolderFonts')"
        :tooltip="node.visible ? t('ui.hideFonts') : t('ui.showFonts')"
        @click="emit('toggle-visibility', rootId, node)"
      >
        <svg v-if="node.visible" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 3 21 21" />
          <path d="M10.6 6.1A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17.3 17.3 0 0 1-3.1 3.8M6.1 6.1C3.9 7.8 2.5 10.3 2.5 12c0 0 3.5 6 9.5 6 1.5 0 2.8-.4 3.9-1" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </svg>
      </AppButton>
    </div>
    <p v-if="node.note && node.note !== node.name" class="folder-note" :data-tooltip="node.path">{{ node.path }}</p>
    <CollapseTransition>
      <div v-if="node.children.length && isExpanded(node.path)" class="folder-children">
        <FolderTreeNode
          v-for="(child, index) in node.children"
          :key="child.path"
          :node="child"
          :root-id="rootId"
          :depth="depth + 1"
          :enter-index="index"
          :selected-path="selectedPath"
          :is-expanded="isExpanded"
          @select="(id, path) => emit('select', id, path)"
          @toggle="path => emit('toggle', path)"
          @toggle-visibility="(id, child) => emit('toggle-visibility', id, child)"
        />
      </div>
    </CollapseTransition>
  </div>
</template>

<style scoped>
.folder-node {
  min-width: 0;
}

.folder-row {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0 6px 0 calc(6px + var(--depth, 1) * 12px);
  border-radius: 6px;
}

.folder-row:hover {
  background: var(--dark-2);
}

.folder-row.selected {
  background: var(--accent-deep);
  color: var(--accent-pale);
}

.folder-label {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--sidebar-fg-soft);
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.folder-row.selected .folder-label {
  color: var(--accent-pale);
}

.folder-row :deep(.app-button) {
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
}

.folder-row :deep(.app-button svg) {
  width: 16px;
  height: 16px;
}

.folder-row :deep(.app-button--plain:hover:not(:disabled)),
.folder-row :deep(.app-button--plain:focus-visible:not(:disabled)) {
  background: color-mix(in srgb, currentColor 16%, transparent);
}

.folder-note {
  margin: 0 0 2px;
  padding-left: calc(24px + var(--depth, 1) * 12px);
  overflow: hidden;
  color: var(--ink-5);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-twist {
  display: grid;
  place-items: center;
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--sidebar-fg-muted);
  cursor: pointer;
}

.folder-twist.placeholder {
  cursor: default;
  pointer-events: none;
}

.folder-twist svg {
  display: block;
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  transition: transform var(--ease);
}

.folder-twist.open svg {
  transform: rotate(90deg);
}

.folder-twist:not(.placeholder):hover {
  background: color-mix(in srgb, currentColor 16%, transparent);
  color: var(--dark-ink);
}

.folder-row.selected .folder-twist {
  color: var(--accent-pale);
}

.folder-row.selected .folder-twist:not(.placeholder):hover {
  color: var(--accent-pale);
}

.folder-children {
  display: flow-root;
  padding-top: 2px;
}

.folder-node--entering {
  animation: folder-item-enter .18s ease both;
  animation-delay: calc(var(--folder-index, 0) * 35ms);
}

@keyframes folder-item-enter {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .folder-node--entering {
    animation: none;
  }
}
</style>
