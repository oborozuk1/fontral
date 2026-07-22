<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppInput from './AppInput.vue'
import AppDialog from './AppDialog.vue'
import AppButton from './AppButton.vue'
import CustomSelect from './CustomSelect.vue'
import FancyScrollbar from './FancyScrollbar.vue'
import RangeSlider from './RangeSlider.vue'
import SegmentedControl from './SegmentedControl.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import type { FolderTarget, Root } from '../composables/useLibrary'
import type { ContextMenuAction, ContextMenuState } from '../composables/useContextMenu'
import {
  COMMON_TAGS_MAX,
  copyNameLanguageOptions,
  copyNameTypeOptions,
  familyNameModeOptions,
  similarityModeOptions,
  FULL_PREVIEW_CONCURRENT_MAX,
  FULL_PREVIEW_CONCURRENT_MIN,
  GRID_MIN_COL_MAX,
  GRID_MIN_COL_MIN,
  GRID_MIN_COL_STEP,
  normalizeCommonTags,
  PREVIEW_CACHE_MAX_MAX,
  PREVIEW_CACHE_MAX_MIN,
  PREVIEW_CACHE_MAX_STEP,
  previewTextPresetOptions,
  themeModeOptions,
  usePreviewTextPresetModel,
  viewModeOptions,
  type CopyNameLanguage,
  type CopyNameType,
  type FamilyNameMode,
  type ThemeMode,
} from '../composables/useSettings'
import { languages, useI18n, type Locale } from '../composables/useI18n'
import { TAG_NAME_MAX, type SimilarityMode } from '@fontral/contracts'

const rootNote = defineModel<string>('rootNote', { required: true })
const language = defineModel<Locale>('language', { required: true })
const defaultPreviewText = defineModel<string>('defaultPreviewText', { required: true })
const defaultPreviewFontSize = defineModel<number>('defaultPreviewFontSize', { required: true })
const lazyPreview = defineModel<boolean>('lazyPreview', { required: true })
const prefetchAhead = defineModel<number>('prefetchAhead', { required: true })
const previewCacheMax = defineModel<number>('previewCacheMax', { required: true })
const fullPreview = defineModel<boolean>('fullPreview', { required: true })
const fullPreviewConcurrent = defineModel<number>('fullPreviewConcurrent', { required: true })
const uiFont = defineModel<string>('uiFont', { required: true })
const monoFont = defineModel<string>('monoFont', { required: true })
const defaultSidebarCollapsed = defineModel<boolean>('defaultSidebarCollapsed', { required: true })
const showSidebarTagline = defineModel<boolean>('showSidebarTagline', { required: true })
const defaultHomeViewMode = defineModel<'grid' | 'list'>('defaultHomeViewMode', { required: true })
const defaultDetailViewMode = defineModel<'grid' | 'list'>('defaultDetailViewMode', { required: true })
const groupByFamily = defineModel<boolean>('groupByFamily', { required: true })
const showOpenFamilyButton = defineModel<boolean>('showOpenFamilyButton', { required: true })
const defaultGridMinCol = defineModel<number>('defaultGridMinCol', { required: true })
const familyNameMode = defineModel<FamilyNameMode>('familyNameMode', { required: true })
const similarityMode = defineModel<SimilarityMode>('similarityMode', { required: true })
const copyNameType = defineModel<CopyNameType>('copyNameType', { required: true })
const copyNameLanguage = defineModel<CopyNameLanguage>('copyNameLanguage', { required: true })
const minimizeToTray = defineModel<boolean>('minimizeToTray', { required: true })
const theme = defineModel<ThemeMode>('theme', { required: true })
const commonTags = defineModel<string[]>('commonTags', { required: true })

const props = defineProps<{
  contextMenu: ContextMenuState | null
  rootToRemove: Root | null
  rootToEditNote: FolderTarget | null
  settingsOpen: boolean
  settingsReady: boolean
  settingsFocus: 'general' | 'tags'
  settingsBodyRef: HTMLElement | null
  quitConfirmOpen: boolean
  customPreviewText: string
  previewPresetTexts: Record<string, string>
  previewPreset: string
}>()

const emit = defineEmits<{
  'context-action': [action: ContextMenuAction]
  'cancel-remove': []
  'confirm-remove': []
  'cancel-note': []
  'save-note': []
  'close-settings': []
  'schedule-default-font-size': []
  'apply-default-font-size': []
  'set-default-preview-preset': [preset: string]
  'set-default-preview-text': [preset: string, text: string]
  'clear-cache': []
  'reload-app': []
  'reset-settings': []
  'rebuild-database': []
  'set-settings-body': [el: unknown]
  'cancel-quit': []
  'confirm-quit': []
  'minimize-to-tray': []
}>()

const resetConfirmOpen = ref(false)
const rebuildConfirmOpen = ref(false)
const commonTagDraft = ref('')
const appVersion = ref('')
const PROJECT_HOMEPAGE = 'https://github.com/oborozuk1/fontral'
const ELECTRON_LICENSE_URL = 'https://github.com/electron/electron/blob/main/LICENSE'
const CHROMIUM_LICENSE_URL = 'https://github.com/electron/electron/blob/main/LICENSES.chromium.html'
void window.fontral.app.getVersion().then(v => { appVersion.value = v }).catch(() => { appVersion.value = '' })
const { t } = useI18n()
const previewTextOptions = computed(() => previewTextPresetOptions(t))
const themes = computed(() => themeModeOptions(t))
const familyNameModes = computed(() => familyNameModeOptions(t))
const similarityModes = computed(() => similarityModeOptions(t))
const copyNameTypes = computed(() => copyNameTypeOptions(t))
const copyNameLanguages = computed(() => copyNameLanguageOptions(t))

function openHomepage() {
  window.fontral.app.openExternal(PROJECT_HOMEPAGE).catch(() => {})
}
function openLicense(url: string) {
  window.fontral.app.openExternal(url).catch(() => {})
}
const viewModes = computed(() => viewModeOptions(t))
const tagsSectionRef = ref<HTMLElement | null>(null)
let backdropPointerId: number | null = null
const savedCustomPreviewText = computed(() => props.customPreviewText)
const savedPreviewPresetTexts = computed(() => props.previewPresetTexts)
const activePreviewPreset = computed(() => props.previewPreset)
const {
  selectedPreset: selectedPreviewTextPreset,
  inputRef: previewTextInput,
  onTextInput: onDefaultPreviewTextInput,
} = usePreviewTextPresetModel(defaultPreviewText, {
  activePreset: activePreviewPreset,
  presetTexts: savedPreviewPresetTexts,
  savedCustomText: savedCustomPreviewText,
  onPresetChange: preset => emit('set-default-preview-preset', preset),
  onTextCommit: (preset, text) => emit('set-default-preview-text', preset, text),
})

function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, TAG_NAME_MAX)
}

function addCommonTag(raw?: string) {
  const name = normalizeTagName(raw ?? commonTagDraft.value)
  if (!name) return
  const next = normalizeCommonTags([...commonTags.value, name])
  if (next.length === commonTags.value.length && next.every((tag, i) => tag === commonTags.value[i])) {
    commonTagDraft.value = ''
    return
  }
  commonTags.value = next
  commonTagDraft.value = ''
}

function removeCommonTag(name: string) {
  commonTags.value = commonTags.value.filter(tag => tag !== name)
}

function onCommonTagKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ',') return
  event.preventDefault()
  addCommonTag()
}

function onBackdropPointerDown(event: PointerEvent) {
  backdropPointerId = event.target === event.currentTarget && event.button === 0 ? event.pointerId : null
}

function onBackdropPointerUp(event: PointerEvent, close: () => void) {
  const shouldClose = backdropPointerId === event.pointerId && event.target === event.currentTarget
  backdropPointerId = null
  if (shouldClose) close()
}

function resetBackdropPointer() {
  backdropPointerId = null
}

function handleResetConfirmKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !resetConfirmOpen.value) return
  event.stopImmediatePropagation()
  resetConfirmOpen.value = false
}

function handleRebuildConfirmKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !rebuildConfirmOpen.value) return
  event.stopImmediatePropagation()
  rebuildConfirmOpen.value = false
}

function handleQuitConfirmKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.quitConfirmOpen) return
  event.stopImmediatePropagation()
  emit('cancel-quit')
}

watch(resetConfirmOpen, open => {
  if (open) window.addEventListener('keydown', handleResetConfirmKeydown, true)
  else window.removeEventListener('keydown', handleResetConfirmKeydown, true)
})

watch(rebuildConfirmOpen, open => {
  if (open) window.addEventListener('keydown', handleRebuildConfirmKeydown, true)
  else window.removeEventListener('keydown', handleRebuildConfirmKeydown, true)
})

watch(() => props.quitConfirmOpen, open => {
  if (open) window.addEventListener('keydown', handleQuitConfirmKeydown, true)
  else window.removeEventListener('keydown', handleQuitConfirmKeydown, true)
})

watch(() => props.settingsOpen, open => {
  if (!open) {
    resetConfirmOpen.value = false
    rebuildConfirmOpen.value = false
    commonTagDraft.value = ''
  }
})

watch(
  () => [props.settingsOpen, props.settingsFocus, props.settingsReady] as const,
  async ([open, focus, ready]) => {
    if (!open || focus !== 'tags' || !ready) return
    await nextTick()
    tagsSectionRef.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleResetConfirmKeydown, true)
  window.removeEventListener('keydown', handleRebuildConfirmKeydown, true)
  window.removeEventListener('keydown', handleQuitConfirmKeydown, true)
})

function confirmResetSettings() {
  resetConfirmOpen.value = false
  emit('reset-settings')
}

function confirmRebuildDatabase() {
  rebuildConfirmOpen.value = false
  emit('rebuild-database')
}
</script>

<template>
  <div
    v-if="contextMenu"
    class="app-context-menu"
    :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    @click.stop
  >
    <button
      v-if="contextMenu.actions.includes('edit-note')"
      type="button"
      @click="$emit('context-action', 'edit-note')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 19 1.2-4.5L15.8 5a1.8 1.8 0 0 1 2.5 2.5L8.7 17.1 5 19Z" />
        <path d="m14.2 6.6 3.2 3.2" />
      </svg>
      {{ t('ui.editNote') }}
    </button>
    <button
      v-if="contextMenu.actions.includes('view-charset')"
      type="button"
      @click="$emit('context-action', 'view-charset')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4.5" y="4.5" width="6" height="6" rx="1" />
        <rect x="13.5" y="4.5" width="6" height="6" rx="1" />
        <rect x="4.5" y="13.5" width="6" height="6" rx="1" />
        <rect x="13.5" y="13.5" width="6" height="6" rx="1" />
      </svg>
      {{ t('ui.viewCharacterSet') }}
    </button>
    <button
      v-if="contextMenu.actions.includes('edit-tags')"
      type="button"
      @click="$emit('context-action', 'edit-tags')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19.8 12.8 12 20.6l-7.8-7.8a1.8 1.8 0 0 1 0-2.5L11.4 3.1a1.8 1.8 0 0 1 1.3-.5H19a1 1 0 0 1 1 1v6.3a1.8 1.8 0 0 1-.5 1.3Z" />
        <circle cx="16" cy="8" r="1.3" />
      </svg>
      {{ t('ui.tagSettings') }}
    </button>
    <button
      v-if="contextMenu.actions.includes('copy-name')"
      type="button"
      @click="$emit('context-action', 'copy-name')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8.5" y="8.5" width="10" height="10" rx="1.2" />
        <path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
      </svg>
      {{ t('ui.copyName') }}
    </button>
    <button
      v-if="contextMenu.actions.includes('add-family-link')"
      type="button"
      @click="$emit('context-action', 'add-family-link')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 14 14 10M8.2 17.8l-2 2a3.2 3.2 0 0 1-4.5-4.5l4.2-4.2a3.2 3.2 0 0 1 4.5 0" />
        <path d="m15.8 6.2 2-2a3.2 3.2 0 1 1 4.5 4.5l-4.2 4.2a3.2 3.2 0 0 1-4.5 0" />
      </svg>
      {{ t('ui.addLinkedFont') }}
    </button>
    <button
      v-if="contextMenu.actions.includes('rescan')"
      type="button"
      :disabled="contextMenu.rescanDisabled"
      @click="$emit('context-action', 'rescan')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19.5 14.2a7 7 0 1 1-1.7-7.3L21 10" />
        <path d="M21 4.5v5.5h-5.5" />
      </svg>
      {{ t('ui.rescan') }}
    </button>
    <button
      v-if="contextMenu.actions.includes('open-folder')"
      type="button"
      @click="$emit('context-action', 'open-folder')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 7.5h4.8l1.6 1.8h8.6v8.4a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7.5Z" />
        <path d="M4.5 10.5h15" />
      </svg>
      {{ t('ui.openFolder') }}
    </button>
    <button
      v-if="contextMenu.actions.includes('copy')"
      type="button"
      @click="$emit('context-action', 'copy')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8.5" y="8.5" width="10" height="10" rx="1.2" />
        <path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
      </svg>
      {{ t('ui.commonCopy') }}
    </button>
    <button
      v-if="contextMenu.actions.includes('paste')"
      type="button"
      @click="$emit('context-action', 'paste')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 4.5h6" />
        <path d="M9.5 3h5v3.5h-5z" />
        <rect x="6.5" y="5.5" width="11" height="14.5" rx="1.5" />
      </svg>
      {{ t('ui.paste') }}
    </button>
    <button
      v-if="contextMenu.actions.includes('remove-root')"
      type="button"
      class="danger"
      @click="$emit('context-action', 'remove-root')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7h14M10 4h4M7 7l.8 12.5h8.4L17 7M10 11v5M14 11v5" />
      </svg>
      {{ t('ui.removeFolder') }}
    </button>
  </div>

  <AppDialog :open="Boolean(rootToRemove)" :ariaLabel="t('ui.removeFromFontral')" :close-on-backdrop="false" @backdrop-pointerdown="onBackdropPointerDown" @backdrop-pointerup="onBackdropPointerUp($event, () => $emit('cancel-remove'))" @backdrop-pointercancel="resetBackdropPointer">
      <template v-if="rootToRemove">
        <p class="modal-eyebrow">{{ t('ui.removeFolder') }}</p>
        <h2 id="remove-root-title">{{ t('ui.removeFromFontral') }}</h2>
        <p>{{ t('ui.fontFilesWillRemainOnDiskOnlyThisFolderSIndexAndDisplayWillBeRemoved') }}</p>
        <p class="modal-path">{{ rootToRemove.path }}</p>
        <div class="modal-actions">
          <AppButton variant="neutral" @click="$emit('cancel-remove')">{{ t('ui.commonCancel') }}</AppButton>
          <AppButton variant="danger" @click="$emit('confirm-remove')">{{ t('ui.removeFolder') }}</AppButton>
        </div>
      </template>
  </AppDialog>

  <AppDialog :open="Boolean(rootToEditNote)" :ariaLabel="t('ui.addNote')" :close-on-backdrop="false" @backdrop-pointerdown="onBackdropPointerDown" @backdrop-pointerup="onBackdropPointerUp($event, () => $emit('cancel-note'))" @backdrop-pointercancel="resetBackdropPointer">
      <template v-if="rootToEditNote">
        <p class="modal-eyebrow">{{ t('ui.folderNote') }}</p>
        <h2 id="edit-note-title">{{ t('ui.addNote') }}</h2>
        <p class="modal-path">{{ rootToEditNote.path }}</p>
        <AppInput
          v-model="rootNote"
          class="modal-input"
          :maxlength="200"
          autofocus
          :placeholder="t('ui.forExampleProjectFontsBrandAssets')"
          :aria-label="t('ui.folderNote')"
          @enter="$emit('save-note')"
        />
        <div class="modal-actions">
          <AppButton variant="neutral" @click="$emit('cancel-note')">{{ t('ui.commonCancel') }}</AppButton>
          <AppButton variant="primary" @click="$emit('save-note')">{{ t('ui.saveNote') }}</AppButton>
        </div>
      </template>
  </AppDialog>

  <AppDialog :open="settingsOpen" :ariaLabel="t('ui.settings')" dialog-class="settings-modal" :dialogStyle="{ display: 'flex', flexDirection: 'column', width: 'min(640px, calc(100vw - 48px))', height: 'min(780px, calc(100vh - 90px))' }" :close-on-backdrop="false" @backdrop-pointerdown="onBackdropPointerDown" @backdrop-pointerup="onBackdropPointerUp($event, () => $emit('close-settings'))" @backdrop-pointercancel="resetBackdropPointer">
        <p class="modal-eyebrow">{{ t('ui.applicationSettings') }}</p>
        <h2 id="settings-title">{{ t('ui.settings') }}</h2>
        <div class="settings-body fancy-scroll">
          <div :ref="el => $emit('set-settings-body', el)" class="settings-body-scroll fancy-scroll__viewport">
            <section class="settings-group">
              <h3>{{ t('ui.preview') }}</h3>
              <div class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.defaultPreviewText') }}</span>
                <CustomSelect
                  v-model="selectedPreviewTextPreset"
                  :options="previewTextOptions"
                  :ariaLabel="t('ui.defaultPreviewTextPreset')"
                />
              </div>
              <label class="settings-field">
                <span class="settings-label">{{ t('ui.previewTextContent') }}</span>
                <AppInput
                  ref="previewTextInput"
                  :model-value="defaultPreviewText"
                  :maxlength="200"
                  :placeholder="t('ui.enterPreviewText')"
                  :aria-label="t('ui.previewTextContent')"
                  @update:model-value="onDefaultPreviewTextInput"
                />
              </label>
              <div class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.defaultFontSize') }}</span>
                <RangeSlider
                  v-model="defaultPreviewFontSize"
                  :aria-label="t('ui.defaultFontSize')"
                  value-position="left"
                  :min="20"
                  :max="160"
                  :step="2"
                  unit="px"
                  @input="$emit('schedule-default-font-size')"
                  @change="$emit('apply-default-font-size')"
                />
              </div>
              <ToggleSwitch
                v-model="lazyPreview"
                :label="t('ui.loadPreviewFontsOnDemand')"
                :description="t('ui.loadPreviewsOnlyWhenCardsEnterViewWhenDisabledLoadTheCurrentListWindowImmediately')"
                :ready="settingsReady"
              />
              <ToggleSwitch
                v-model="fullPreview"
                :label="t('ui.fullPreview')"
                :description="t('ui.loadFullFontsInsteadOfPreviewSubsetsUsingMoreMemoryAndDiskSpace')"
                :ready="settingsReady"
              />
              <div v-if="fullPreview" class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.concurrentFullFontDecodes') }}</span>
                <RangeSlider
                  v-model="fullPreviewConcurrent"
                  :aria-label="t('ui.concurrentFullFontDecodes')"
                  value-position="left"
                  :min="FULL_PREVIEW_CONCURRENT_MIN"
                  :max="FULL_PREVIEW_CONCURRENT_MAX"
                  :step="1"
                />
              </div>
              <div v-if="lazyPreview" class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.prefetchCountAfterStopping') }}</span>
                <RangeSlider
                  v-model="prefetchAhead"
                  :aria-label="t('ui.prefetchCountAfterStopping')"
                  value-position="left"
                  :min="0"
                  :max="24"
                  :step="4"
                />
              </div>
              <div class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.previewsKeptInMemory') }}</span>
                <RangeSlider
                  v-model="previewCacheMax"
                  :aria-label="t('ui.previewsKeptInMemory')"
                  value-position="left"
                  :min="PREVIEW_CACHE_MAX_MIN"
                  :max="PREVIEW_CACHE_MAX_MAX"
                  :step="PREVIEW_CACHE_MAX_STEP"
                />
              </div>
            </section>
            <section class="settings-group">
              <h3>{{ t('ui.interface') }}</h3>
              <div class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.language') }}</span>
                <CustomSelect v-model="language" :options="Object.entries(languages).map(([value, label]) => ({ value, label }))" :ariaLabel="t('ui.language')" />
              </div>
              <div class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.theme') }}</span>
                <CustomSelect v-model="theme" :options="themes" :ariaLabel="t('ui.theme')" />
              </div>
              <label class="settings-field">
                <span class="settings-label">{{ t('ui.interfaceFont') }}</span>
                <AppInput
                  v-model="uiFont"
                  :maxlength="200"
                  :spellcheck="false"
                  :placeholder="t('ui.forExampleSystemUiOrMicrosoftYahei')"
                  :aria-label="t('ui.interfaceFont')"
                />
              </label>
              <label class="settings-field">
                <span class="settings-label">{{ t('ui.monospaceFont') }}</span>
                <AppInput
                  v-model="monoFont"
                  :maxlength="200"
                  :spellcheck="false"
                  :placeholder="t('ui.forExampleConsolasOrCascadiaMono')"
                  :aria-label="t('ui.monospaceFont')"
                />
              </label>
              <ToggleSwitch
                v-model="defaultSidebarCollapsed"
                :label="t('ui.collapseSidebarByDefault')"
                :ready="settingsReady"
              />
              <ToggleSwitch
                v-model="showSidebarTagline"
                :label="t('ui.showSidebarTagline')"
                :ready="settingsReady"
              />
              <ToggleSwitch
                v-model="minimizeToTray"
                :label="t('ui.minimizeToTrayOnClose')"
                :ready="settingsReady"
              />
            </section>
            <section class="settings-group">
              <h3>{{ t('ui.browsing') }}</h3>
               <div class="settings-field settings-field--inline">
                 <span class="settings-label">{{ t('ui.fontFamilyName') }}</span>
                 <SegmentedControl v-model="familyNameMode" :options="familyNameModes" :ariaLabel="t('ui.fontFamilyName')" />
               </div>
               <div class="settings-field settings-field--inline">
                 <span class="settings-label">{{ t('ui.similarityCalculation') }}</span>
                 <SegmentedControl v-model="similarityMode" :options="similarityModes" :ariaLabel="t('ui.similarityCalculation')" />
               </div>
              <div class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.copyName') }}</span>
                <CustomSelect v-model="copyNameType" :options="copyNameTypes" :ariaLabel="t('ui.copyName')" />
              </div>
              <div class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.copyLanguage') }}</span>
                <SegmentedControl v-model="copyNameLanguage" :options="copyNameLanguages" :ariaLabel="t('ui.copyLanguage')" />
              </div>
              <div class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.defaultHomeView') }}</span>
                <SegmentedControl v-model="defaultHomeViewMode" :options="viewModes" :ariaLabel="t('ui.defaultHomeView')" />
              </div>
              <div class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.defaultFamilyView') }}</span>
                <SegmentedControl v-model="defaultDetailViewMode" :options="viewModes" :ariaLabel="t('ui.defaultFamilyView')" />
              </div>
              <ToggleSwitch
                v-model="groupByFamily"
                :label="t('ui.groupByFontFamily')"
                :description="t('ui.showOnlyRegularForEachFamilyOnTheHomePageOrAnotherWeightWhenUnavailable')"
                :ready="settingsReady"
              />
              <ToggleSwitch
                v-model="showOpenFamilyButton"
                :label="t('ui.showViewFontFamilyButton')"
                :ready="settingsReady"
              />
              <div class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.gridCardWidth') }}</span>
                <RangeSlider
                  v-model="defaultGridMinCol"
                  :aria-label="t('ui.gridCardWidth')"
                  :min="GRID_MIN_COL_MIN"
                  :max="GRID_MIN_COL_MAX"
                  :step="GRID_MIN_COL_STEP"
                  unit="px"
                  value-position="left"
                />
              </div>
            </section>
            <section ref="tagsSectionRef" class="settings-group">
              <h3>{{ t('ui.commonTags') }}</h3>
              <p class="settings-hint">{{ t('settings.commonTagLimit', { count: COMMON_TAGS_MAX }) }}</p>
              <div class="settings-common-tags">
                <TransitionGroup name="settings-tag">
                  <span v-for="tag in commonTags" :key="tag" class="settings-common-tag">
                    {{ tag }}
                    <button type="button" class="settings-common-tag-remove" :aria-label="`${t('ui.removeTag')} ${tag}`" @click="removeCommonTag(tag)">×</button>
                  </span>
                </TransitionGroup>
                <div class="settings-common-tag-input-wrap">
                  <AppInput
                    v-model="commonTagDraft"
                    class="settings-common-tag-input"
                    variant="plain"
                    :maxlength="TAG_NAME_MAX"
                    :disabled="commonTags.length >= COMMON_TAGS_MAX"
                    :placeholder="commonTags.length ? t('ui.addCommonTag') : t('ui.enterATagAndPressEnter')"
                    autocomplete="off"
                    :aria-label="t('ui.addCommonTag')"
                    @keydown="onCommonTagKeydown"
                    @blur="addCommonTag()"
                  />
                </div>
              </div>
              <p class="settings-hint">{{ commonTags.length }}/{{ COMMON_TAGS_MAX }}</p>
            </section>
            <section class="settings-group">
              <h3>{{ t('ui.maintenance') }}</h3>
              <div class="settings-actions-row">
                <AppButton variant="secondary" @click="$emit('clear-cache')">{{ t('ui.clearPreviewCache') }}</AppButton>
                <AppButton variant="secondary" @click="$emit('reload-app')">{{ t('ui.reloadApp') }}</AppButton>
                <AppButton variant="secondary" @click="rebuildConfirmOpen = true">{{ t('ui.rebuildDatabase') }}</AppButton>
                <AppButton variant="secondary" @click="resetConfirmOpen = true">{{ t('ui.restoreDefaultSettings') }}</AppButton>
              </div>
            </section>
            <section class="settings-group">
              <h3>{{ t('ui.about') }}</h3>
              <div class="settings-field settings-field--inline">
                <span class="settings-label">{{ t('ui.appVersion') }}</span>
                <span class="settings-value">{{ appVersion || '—' }}</span>
              </div>
              <div class="settings-actions-row">
                <AppButton variant="secondary" @click="openHomepage">{{ t('ui.projectHomepage') }}</AppButton>
                <AppButton variant="secondary" @click="openLicense(ELECTRON_LICENSE_URL)">{{ t('ui.electronLicense') }}</AppButton>
                <AppButton variant="secondary" @click="openLicense(CHROMIUM_LICENSE_URL)">{{ t('ui.chromiumLicense') }}</AppButton>
              </div>
            </section>
          </div>
          <FancyScrollbar :target="settingsBodyRef" :aria-label="t('ui.settingsScrollbar')" />
        </div>
        <div class="modal-actions">
          <AppButton variant="primary" @click="$emit('close-settings')">{{ t('ui.done') }}</AppButton>
        </div>
  </AppDialog>

  <AppDialog :open="resetConfirmOpen" :ariaLabel="t('ui.restoreDefaultSettings2')" backdrop-class="app-dialog-backdrop--nested" :close-on-backdrop="false" @backdrop-pointerdown="onBackdropPointerDown" @backdrop-pointerup="onBackdropPointerUp($event, () => { resetConfirmOpen = false })" @backdrop-pointercancel="resetBackdropPointer">
        <p class="modal-eyebrow">{{ t('ui.restoreDefaults') }}</p>
        <h2 id="reset-settings-title">{{ t('ui.restoreDefaultSettings2') }}</h2>
        <p>{{ t('ui.thisResetsPreviewInterfaceAndBrowsingOptionsThisCannotBeUndone') }}</p>
        <div class="modal-actions">
          <AppButton variant="neutral" @click="resetConfirmOpen = false">{{ t('ui.commonCancel') }}</AppButton>
          <AppButton variant="danger" @click="confirmResetSettings">{{ t('ui.restoreDefaults') }}</AppButton>
        </div>
  </AppDialog>

  <AppDialog :open="rebuildConfirmOpen" :ariaLabel="t('ui.rebuildDatabase2')" backdrop-class="app-dialog-backdrop--nested" :close-on-backdrop="false" @backdrop-pointerdown="onBackdropPointerDown" @backdrop-pointerup="onBackdropPointerUp($event, () => { rebuildConfirmOpen = false })" @backdrop-pointercancel="resetBackdropPointer">
        <p class="modal-eyebrow">{{ t('ui.fontLibrary') }}</p>
        <h2 id="rebuild-database-title">{{ t('ui.rebuildDatabase2') }}</h2>
        <p>{{ t('ui.thisClearsFontIndexesFavoritesNotesAndTagsThenRescansAddedFoldersFolderListsAndNotesAreKeptThisCannotBeUndone') }}</p>
        <div class="modal-actions">
          <AppButton variant="neutral" @click="rebuildConfirmOpen = false">{{ t('ui.commonCancel') }}</AppButton>
          <AppButton variant="danger" @click="confirmRebuildDatabase">{{ t('ui.rebuildDatabase') }}</AppButton>
        </div>
  </AppDialog>

  <AppDialog :open="quitConfirmOpen" :ariaLabel="t('ui.quitFontral')" backdrop-class="app-dialog-backdrop--quit" :close-on-backdrop="false" @backdrop-pointerdown="onBackdropPointerDown" @backdrop-pointerup="onBackdropPointerUp($event, () => $emit('cancel-quit'))" @backdrop-pointercancel="resetBackdropPointer">
        <p class="modal-eyebrow">{{ t('ui.closeApplication') }}</p>
        <h2 id="quit-confirm-title">{{ t('ui.quitFontral') }}</h2>
        <p>{{ t('ui.thisQuitsTheApplicationAndDeactivatesFontsActivatedInThisSession') }}</p>
        <div class="modal-actions modal-actions--quit">
          <AppButton variant="neutral" @click="$emit('cancel-quit')">{{ t('ui.commonCancel') }}</AppButton>
          <AppButton variant="neutral" @click="$emit('minimize-to-tray')">{{ t('ui.minimizeToTray') }}</AppButton>
          <AppButton variant="danger" @click="$emit('confirm-quit')">{{ t('ui.quit') }}</AppButton>
        </div>
  </AppDialog>
</template>

<style scoped>
.app-context-menu {
  position: fixed;
  z-index: 1300;
  min-width: 140px;
  padding: 4px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--bg-white);
  box-shadow: var(--shadow-lg);
}

.app-context-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 7px 9px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.2;
  text-align: left;
  cursor: pointer;
}

.app-context-menu button:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.app-context-menu button:disabled {
  opacity: .4;
  cursor: default;
}

.app-context-menu button.danger:hover:not(:disabled) {
  background: var(--danger-soft);
  color: var(--danger-soft-ink);
}

.app-context-menu svg {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.75;
  overflow: visible;
  translate: 0 0.5px;
}

:deep(.app-dialog-backdrop) { -webkit-app-region: no-drag; }
:deep(.app-dialog-backdrop--nested) { z-index: 1200; }
:deep(.app-dialog-backdrop--quit) { z-index: 1500; }

.modal-eyebrow {
  margin: 0 0 10px;
  color: var(--accent);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .14em;
}

:deep(.app-dialog) h2 {
  margin: 0;
  color: var(--ink);
  font-size: 21px;
  letter-spacing: -.03em;
  text-transform: none;
}

:deep(.app-dialog) > p:not(.modal-eyebrow) {
  margin: 12px 0 0;
  color: var(--ink-4);
  font-size: 13px;
  line-height: 1.6;
}

.modal-path {
  overflow: hidden;
  padding: 9px 11px;
  border-radius: var(--radius-sm);
  background: var(--modal-path-bg);
  user-select: text;
  color: var(--modal-path-ink) !important;
  font-family: var(--ui-font);
  font-size: 11px !important;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-input {
  width: 100%;
  margin-top: 16px;
  height: 42px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 23px;
}

.modal-actions--quit {
  flex-wrap: wrap;
}

.settings-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  margin-top: 18px;
  margin-right: -26px;
}

.settings-body-scroll {
  display: grid;
  gap: 18px;
  min-height: 100%;
  padding: 0 26px 8px 0;
}

.settings-hint {
  margin: 0 0 10px;
  color: var(--ink-5);
  font-size: 12px;
  line-height: 1.45;
}

.settings-common-tags + .settings-hint {
  margin: 8px 0 0;
}

.settings-common-tags {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  background: var(--bg-white);
}

.settings-common-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 4px 8px 4px 10px;
  border-radius: 999px;
  background: var(--tag-bg);
  color: var(--tag-ink);
  font-size: 12px;
  font-weight: 400;
}

.settings-common-tag-remove {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--tag-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--ease), color var(--ease);
}

.settings-common-tag-remove:hover {
  background: var(--tag-remove-bg);
  color: var(--tag-remove-ink);
}

.settings-common-tag-input-wrap {
  flex: 1 1 140px;
  min-width: 120px;
}

.settings-common-tag-input {
  width: 100%;
  min-height: 28px;
  padding: 4px 2px;
}

.settings-group {
  padding: 14px;
  border: 1px solid var(--settings-group-border);
  border-radius: 10px;
  background-color: var(--bg-white);
}

.settings-group h3 {
  margin: 0 0 12px;
  color: var(--ink-3);
  font-size: 14px;
  font-weight: 800;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.settings-field {
  display: grid;
  gap: 8px;
  margin: 0 0 14px;
}

.settings-field:last-child {
  margin-bottom: 0;
}

.settings-field--inline {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px 16px;
}

.settings-label {
  color: var(--ink);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.35;
}

.settings-value {
  color: var(--ink-light);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.settings-link {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent, #3b6dc0);
  font: inherit;
  font-size: 13px;
  text-align: right;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.settings-link:hover,
.settings-link:focus-visible {
  opacity: 0.8;
}

.settings-field :deep(.app-input) {
  width: 100%;
  height: 40px;
  border-radius: var(--radius-sm);
}

.settings-field :deep(.custom-select-trigger),
.settings-field :deep(.custom-select-options button) {
  font-size: 13px;
}

.settings-field--inline :deep(.range-slider) {
  justify-self: end;
  height: 40px;
}

.settings-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

:deep(.settings-modal) .modal-actions {
  flex: none;
  margin-top: 18px;
}

.settings-tag-enter-active,
.settings-tag-leave-active {
  transition: opacity .2s ease, transform .2s ease;
}

.settings-tag-enter-from {
  opacity: 0;
  transform: scale(.7);
}

.settings-tag-leave-to {
  opacity: 0;
  transform: scale(.7);
}

.settings-tag-leave-active {
  position: absolute;
}

.settings-tag-move {
  transition: transform .2s ease;
}
</style>
