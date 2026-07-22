<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { FolderSelection, Root } from '../composables/useLibrary'
import type { FolderNode } from '../composables/useLibrary'
import { folderName, scanPercent } from '../composables/useLibrary'
import type { LibraryView } from '../composables/useFonts'
import { clampSidebarWidth } from '../composables/useSettings'
import { useI18n } from '../composables/useI18n'
import AppButton from './AppButton.vue'
import CollapseTransition from './CollapseTransition.vue'
import FancyScrollbar from './FancyScrollbar.vue'
import FolderTreeNode from './FolderTreeNode.vue'

const props = defineProps<{
  roots: Root[]
  selectedFolder: FolderSelection
  libraryView: LibraryView
  isExpanded: (path: string) => boolean
  showTagline: boolean
}>()

const emit = defineEmits<{
  'add-root': []
  'open-settings': []
  'toggle-visibility': [root: Root]
  'toggle-folder-visibility': [rootId: number, node: FolderNode]
  'select-folder': [rootId: number, path: string]
  'toggle-expand': [path: string]
  'clear-folder': []
  'set-library-view': [view: LibraryView]
  'resize': [width: number]
}>()

const { t } = useI18n()

const libraryViews = computed(() => [
  { id: 'all', label: t('ui.allFonts') },
  { id: 'favorites', label: t('ui.favorites') },
  { id: 'active', label: t('ui.active') },
  { id: 'inactive', label: t('ui.inactive') },
] satisfies Array<{ id: LibraryView; label: string }>)

const rootEl = ref<HTMLElement | null>(null)
const rootsScrollRef = ref<HTMLElement | null>(null)
defineExpose({ el: rootEl })

let resizing = false
let startX = 0
let startWidth = 0

function onResizePointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const aside = rootEl.value
  if (!aside) return
  event.preventDefault()
  resizing = true
  startX = event.clientX
  startWidth = aside.getBoundingClientRect().width
  document.body.classList.add('sidebar-resizing')
  window.addEventListener('pointermove', onResizePointerMove)
  window.addEventListener('pointerup', onResizePointerUp)
  window.addEventListener('pointercancel', onResizePointerUp)
}

function onResizePointerMove(event: PointerEvent) {
  if (!resizing) return
  emit('resize', clampSidebarWidth(startWidth + (event.clientX - startX)))
}

function onResizePointerUp() {
  if (!resizing) return
  resizing = false
  document.body.classList.remove('sidebar-resizing')
  window.removeEventListener('pointermove', onResizePointerMove)
  window.removeEventListener('pointerup', onResizePointerUp)
  window.removeEventListener('pointercancel', onResizePointerUp)
}

onBeforeUnmount(() => {
  onResizePointerUp()
})

function rootSelected(root: Root) {
  return props.selectedFolder?.rootId === root.id && props.selectedFolder.path === root.path
}

function selectedPathFor(root: Root) {
  return props.selectedFolder?.rootId === root.id ? props.selectedFolder.path : null
}
</script>

<template>
  <aside ref="rootEl" :class="{ 'sidebar--without-tagline': !showTagline }">
    <div
      class="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('ui.resizeSidebar')"
      @pointerdown="onResizePointerDown"
    ></div>
    <div v-if="showTagline">
      <h1>{{ t('ui.yourFonts') }}<br />{{ t('ui.managedInOnePlace') }}</h1>
    </div>
    <div class="sidebar-actions">
      <button class="action-button" type="button" @click="emit('add-root')"><span aria-hidden="true">+</span> {{ t('ui.addFontFolder') }}</button>
      <AppButton variant="dark" size="lg" :label="t('ui.settings')" :tooltip="t('ui.settings')" @click="emit('open-settings')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      </AppButton>
    </div>
    <section class="library-views" :aria-label="t('ui.fontViews')">
      <button
        v-for="view in libraryViews"
        :key="view.id"
        type="button"
        class="library-view-button"
        :class="[
          `library-view-button--${view.id}`,
          { active: libraryView === view.id },
        ]"
        @click="emit('set-library-view', view.id)"
      >
        <svg v-if="view.id === 'all'" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h10" />
        </svg>
        <svg v-else-if="view.id === 'favorites'" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m12 3.6 2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.62 6.9 19.3l.97-5.68-4.12-4.02 5.7-.83L12 3.6Z" />
        </svg>
        <svg v-else-if="view.id === 'active'" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v10" />
          <path d="m8.5 9.5 3.5 3.5 3.5-3.5" />
          <path d="M5 16.5h14" />
          <path d="M7 20h10" />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7.5" />
          <path d="M8 12h8" />
        </svg>
        <span>{{ view.label }}</span>
      </button>
    </section>
    <section class="roots">
      <div class="roots-heading">
        <h2>{{ t('ui.addedFolders') }}</h2>
        <button
          type="button"
          class="clear-folder"
          :class="{ visible: !!selectedFolder }"
          :disabled="!selectedFolder"
          :tabindex="selectedFolder ? 0 : -1"
          :data-tooltip="t('ui.clearFolderFilter')"
          @click="emit('clear-folder')"
        >
          {{ t('ui.commonAll') }}
        </button>
      </div>
      <div class="roots-content fancy-scroll">
        <div ref="rootsScrollRef" class="roots-scroll fancy-scroll__viewport">
          <p v-if="!roots.length" class="muted">{{ t('ui.noFoldersAdded') }}</p>
          <div
            v-for="root in roots"
            :key="root.id"
            class="root"
            :class="{ selected: rootSelected(root) }"
            :data-root-id="root.id"
            :data-root-path="root.path"
            :data-folder-path="root.path"
            :data-scan-status="root.scanStatus"
          >
          <div class="root-heading">
            <button
              v-if="root.children.length"
              type="button"
              class="folder-twist"
              :class="{ open: isExpanded(root.path) }"
              :aria-label="isExpanded(root.path) ? t('ui.collapseSubfolders') : t('ui.expandSubfolders')"
              @click="emit('toggle-expand', root.path)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
            <span v-else class="folder-twist placeholder"></span>
            <button
              type="button"
              class="root-name"
              :class="{ selected: rootSelected(root) }"
              :data-tooltip="root.path"
              :data-folder-path="root.path"
              :data-root-id="root.id"
              @click="emit('select-folder', root.id, root.path)"
            >
              {{ root.note || folderName(root.path) }}
            </button>
            <div class="root-actions">
              <AppButton
                variant="plain"
                size="sm"
                :label="root.visible ? t('ui.hideFolderFonts') : t('ui.showFolderFonts')"
                :tooltip="root.visible ? t('ui.hideFonts') : t('ui.showFonts')"
                @click="emit('toggle-visibility', root)"
              >
                <svg v-if="root.visible" viewBox="0 0 24 24" aria-hidden="true">
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
          </div>
          <small v-if="root.scanStatus === 'scanning'" class="root-status">{{ t('ui.scanning') }} {{ scanPercent(root) }}%</small>
          <small v-else-if="root.scanStatus !== 'idle'" class="root-status">{{ root.scanStatus }}</small>
          <p v-if="root.note && root.note !== folderName(root.path)" class="root-note" :data-tooltip="root.path">{{ root.path }}</p>
          <div
            v-if="root.scanStatus === 'scanning'"
            class="scan-progress"
            role="progressbar"
            :aria-valuenow="scanPercent(root)"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <i :style="{ width: `${scanPercent(root)}%` }"></i>
          </div>
          <CollapseTransition>
            <div v-if="root.children.length && isExpanded(root.path)" class="folder-children root-children">
              <FolderTreeNode
                v-for="(child, index) in root.children"
                :key="child.path"
                :node="child"
                :root-id="root.id"
                :depth="1"
                :enter-index="index"
                :selected-path="selectedPathFor(root)"
                :is-expanded="isExpanded"
                @select="(id, path) => emit('select-folder', id, path)"
                @toggle="path => emit('toggle-expand', path)"
                @toggle-visibility="(id, node) => emit('toggle-folder-visibility', id, node)"
              />
            </div>
          </CollapseTransition>
          </div>
        </div>
        <FancyScrollbar :target="rootsScrollRef" :aria-label="t('ui.folderListScrollbar')" />
      </div>
    </section>
  </aside>
</template>

<style scoped>
aside {
  position: relative;
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  height: 100%;
  min-height: 0;
  padding: 24px 16px 24px;
  background-color: var(--dark);
  color: var(--dark-ink);
  overflow: hidden;
  contain: paint;
}

.sidebar-resizer {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 5;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;
  -webkit-app-region: no-drag;
}

.sidebar-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  right: 2px;
  width: 2px;
  height: 100%;
  background: transparent;
  transition: background .15s;
}

.sidebar-resizer:hover::after,
:global(body.sidebar-resizing) .sidebar-resizer::after {
  background: color-mix(in srgb, var(--accent-lit) 55%, transparent);
}

:global(body.sidebar-resizing),
:global(body.sidebar-resizing *) {
  cursor: col-resize !important;
  user-select: none;
}

.muted {
  color: var(--ink-5);
}

aside h1 {
  margin: 0;
  font-size: 31px;
}

.sidebar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 0;
}

.sidebar--without-tagline {
  padding-top: 16px;
}

.sidebar--without-tagline .sidebar-actions {
  margin-top: 0;
}

.library-views {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 22px;
}

.library-view-button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--sidebar-fg);
  font: inherit;
  font-size: 14px;
  font-weight: 400;
  text-align: left;
  cursor: pointer;
  transition: background var(--ease), color var(--ease);
}

.library-view-button svg {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.library-view-button--favorites.active svg {
  fill: currentColor;
}

.library-view-button:hover {
  background: var(--dark-2);
  color: var(--dark-ink);
}

.library-view-button.active {
  background: var(--accent-deep);
  color: var(--accent-pale);
}

.action-button {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: var(--accent-lit);
  color: var(--accent-action-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  cursor: pointer;
  transition: background var(--ease), color var(--ease);
  -webkit-app-region: no-drag;
}

.action-button span {
  font-size: 18px;
  font-weight: 400;
  line-height: .7;
}

.action-button:hover {
  background: var(--accent-action);
}

.action-button:active {
  background: var(--accent-action-active);
}

.action-button:focus-visible {
  outline: 2px solid var(--accent-lit);
  outline-offset: -3px;
}

h2 {
  margin: 0 0 12px;
  color: var(--ink-5);
  font-size: 11px;
  font-weight: 400;
}

.roots {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  margin-right: -12px;
}

.roots-content {
  flex: 1;
  min-height: 0;
}

.roots-scroll {
  height: 100%;
  padding-right: 14px;
}

.roots-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
  padding-right: 14px;
}

.roots-heading h2 {
  margin: 0;
}

.clear-folder {
  margin: 0;
  padding: 2px 8px;
  border: 1px solid var(--dark-line);
  border-radius: 999px;
  background: var(--dark-soft);
  color: var(--accent-lit);
  font: inherit;
  font-size: 11px;
  font-weight: 400;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
}

.clear-folder.visible {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
}

.clear-folder.visible:hover {
  border-color: var(--accent);
  color: var(--accent-pale);
}

.root {
  margin: 4px 0 8px;
  color: var(--sidebar-fg-soft);
  font-size: 12px;
}

.root-heading {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding-right: 6px;
  border-radius: 6px;
}

.root-heading:hover {
  background: var(--dark-2);
}

.root-heading > .folder-twist {
  margin-left: 6px;
}

.root-name {
  flex: 1;
  min-width: 0;
  margin: 0 0 0 -4px;
  padding: 4px 6px;
  overflow: hidden;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.root-name:hover {
  background: transparent;
}

.root.selected > .root-heading {
  background: var(--accent-deep);
  color: var(--accent-pale);
}

.root-status {
  display: block;
  margin: 4px 0 0 24px;
  color: var(--accent-lit);
  white-space: nowrap;
}

.root-note {
  margin: 4px 0 0 24px;
  overflow: hidden;
  color: var(--ink-5);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.root-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
}

.root-actions :deep(.app-button) {
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
}

.root-actions :deep(.app-button svg) {
  width: 16px;
  height: 16px;
}

.root-actions :deep(.app-button--plain:hover:not(:disabled)),
.root-actions :deep(.app-button--plain:focus-visible:not(:disabled)) {
  background: color-mix(in srgb, currentColor 16%, transparent);
}

.root.selected .folder-twist {
  color: var(--accent-pale);
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

.root.selected .folder-twist:not(.placeholder):hover {
  color: var(--accent-pale);
}

.folder-children {
  display: flow-root;
  padding-top: 2px;
}

.root-children {
  margin-left: 2px;
}

.scan-progress {
  height: 4px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 99px;
  background: var(--dark-progress);
}

.scan-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent-lit);
  transition: width var(--ease);
}

@media (max-width: 780px) {
  aside {
    width: 100%;
    height: auto;
    padding: 25px 20px;
    overflow: visible;
  }

  .sidebar-resizer {
    display: none;
  }
}
</style>
