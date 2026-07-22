<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { FontFaceSummary } from '@fontral/contracts'
import FancyScrollbar from './components/FancyScrollbar.vue'
import AppButton from './components/AppButton.vue'
import AppInput from './components/AppInput.vue'
import AppTitlebar from './components/AppTitlebar.vue'
import AppSidebar from './components/AppSidebar.vue'
import PreviewControls from './components/PreviewControls.vue'
import AdvancedFilters from './components/AdvancedFilters.vue'
import FontCard from './components/FontCard.vue'
import FontDetailPanels from './components/FontDetailPanels.vue'
import AppModals from './components/AppModals.vue'
import { useSettings } from './composables/useSettings'
import {
  QUERY_PREFETCH_AHEAD,
  resolveCopyName,
  useFonts,
  type FormatFilter,
  type ItalicFilter,
  type LanguageFilter,
  type LibraryView,
  type VariableFilter,
  type WeightFilter,
} from './composables/useFonts'
import { useLibrary } from './composables/useLibrary'
import { useActivation } from './composables/useActivation'
import { useFontPreview } from './composables/useFontPreview'
import { useVirtualList } from './composables/useVirtualList'
import { useContextMenu } from './composables/useContextMenu'
import { useI18n } from './composables/useI18n'

const api = window.fontral
const error = ref('')
const text = ref('')
const { t } = useI18n()
const libraryView = ref<LibraryView>('all')
const weight = ref<WeightFilter>(null)
const italic = ref<ItalicFilter>('')
const variable = ref<VariableFilter>('')
const languages = ref<LanguageFilter>([])
const filterTags = ref<string[]>([])
const formats = ref<FormatFilter[]>([])
const glyphCountMin = ref<number | null>(null)
const glyphCountMax = ref<number | null>(null)
const coversPreviewText = ref(false)
const filtersOpen = ref(false)
const contentBodyRef = ref<HTMLElement | null>(null)
const listSpacerRef = ref<HTMLElement | null>(null)
const sidebarRef = ref<{ el: HTMLElement | null } | null>(null)
const pageScrollbar = ref<{ sync: () => void } | null>(null)
const fontDetailPanelsRef = ref<{
  openCharsetViewer: (source: 'unicode' | 'cjk', key: string, title: string) => void
  copySimilarFaceName: (faceId: number) => void
  addSimilarFaceLink: (sourceFaceId: number, targetFaceId: number) => Promise<void>
  scrollEl: HTMLElement | null
} | null>(null)
const settingsBodyRef = ref<HTMLElement | null>(null)
let homeScrollTop = 0

const setError = (message: string) => {
  error.value = message
}

let onFacesLoaded: (faces: FontFaceSummary[], meta?: { replace?: boolean }) => void = () => { }

const selectedFamilyHolder = ref<string | null>(null)
const headerFamilyName = ref<string | null>(null)
const headerFamilyCount = ref(0)

type FamilyHistoryEntry = {
  family: string
  scroll: number
  faceId: number | null
  tab: 'preview' | 'similar' | 'properties' | 'charset' | 'notes'
}
const familyHistory = ref<FamilyHistoryEntry[]>([])
const settings = useSettings(selectedFamilyHolder)

const {
  roots,
  rootToRemove,
  folderToEditNote,
  rootNote,
  selectedFolder,
  refreshRoots,
  addRoot,
  rescanFolder,
  toggleRootVisibility,
  toggleFolderVisibility,
  removeRoot,
  confirmRemoveRoot,
  editFolderNote,
  saveFolderNote,
  isExpanded,
  toggleExpanded,
  selectFolder,
  clearFolderSelection,
} = useLibrary(api, setError, () => void refreshFonts())

const {
  activeFaceIds,
  activatingFaceIds,
  initialize: initializeActivation,
  toggleActivation,
  handleActivationStatus,
} = useActivation(api, setError)

const selectedRootId = computed(() => selectedFolder.value?.rootId)
const selectedPathPrefix = computed(() => selectedFolder.value?.path)

const {
  faces,
  selectedFamily,
  familyFaces,
  familyLoading,
  activeDetailTab,
  detailTabs,
  selectedDetail,
  selectedDetailFaceId,
  detailLoading,
  detailNote,
  detailTags,
  detailLanguage,
  availableTags,
  noteSaveStatus,
  copiedName,
  copiedFamily,
  loading,
  loadingMore,
  hasMore,
  totalFaces,
  displayedFaces,
  refresh,
  loadMore,
  openFamily,
  refreshFamilyFaces,
  closeFamily,
  refreshAvailableTags,
  saveDetailNote,
  saveDetailLanguage,
  copyName,
  copyFamilyName,
  copyFaceName,
  toggleFavorite,
  queryInput,
  linkedDisplayQuery,
} = useFonts(
  api,
  {
    text,
    libraryView,
    activeFaceIds,
    weight,
    italic,
    variable,
    languages,
    tags: filterTags,
    formats,
    glyphCountMin,
    glyphCountMax,
    groupByFamily: settings.groupByFamily,
    rootId: selectedRootId,
    pathPrefix: selectedPathPrefix,
  },
  setError,
  (facesList, meta) => onFacesLoaded(facesList, meta),
)

/** Source set for preview loading (unfiltered). Coverage filtering only hides cards after load. */
const previewFaces = computed(() => (selectedFamily.value ? familyFaces.value : faces.value))

function refreshFonts() {
  void refresh()
}

function rememberHomeScroll() {
  const root = contentBodyRef.value
  if (root && !selectedFamily.value) homeScrollTop = root.scrollTop
}

function applyScrollTop(top: number) {
  const root = selectedFamily.value
    ? fontDetailPanelsRef.value?.scrollEl ?? null
    : contentBodyRef.value
  if (root) root.scrollTop = top
  measureVirtualList()
  syncPageScrollbar()
}

function syncPageScrollbar() {
  pageScrollbar.value?.sync()
}

function relayoutList() {
  measureVirtualList()
  const root = listScrollRoot.value
  if (root) {
    const maxTop = Math.max(0, root.scrollHeight - root.clientHeight)
    if (root.scrollTop > maxTop) root.scrollTop = maxTop
  }
  syncPageScrollbar()
  // Virtual spacer height is applied via CSSOM; wait for layout before reading scroll metrics.
  requestAnimationFrame(() => {
    measureVirtualList()
    const nextRoot = listScrollRoot.value
    if (nextRoot) {
      const maxTop = Math.max(0, nextRoot.scrollHeight - nextRoot.clientHeight)
      if (nextRoot.scrollTop > maxTop) nextRoot.scrollTop = maxTop
    }
    syncPageScrollbar()
    requestAnimationFrame(() => syncPageScrollbar())
  })
}

function setSettingsBody(el: unknown) {
  settingsBodyRef.value = el instanceof HTMLElement ? el : null
}

async function handleOpenFamily(family: string) {
  if (selectedFamily.value) {
    familyHistory.value.push({
      family: selectedFamily.value,
      scroll: fontDetailPanelsRef.value?.scrollEl?.scrollTop ?? 0,
      faceId: selectedDetailFaceId.value,
      tab: activeDetailTab.value,
    })
  } else {
    rememberHomeScroll()
  }
  await openFamily(family)
  await nextTick()
  applyScrollTop(0)
}

async function handleCloseFamily() {
  const previous = familyHistory.value.pop()
  if (previous) {
    await openFamily(previous.family)
    if (previous.faceId && familyFaces.value.some(face => face.id === previous.faceId)) {
      selectedDetailFaceId.value = previous.faceId
    }
    activeDetailTab.value = previous.tab
    await nextTick()
    applyScrollTop(previous.scroll)
    requestAnimationFrame(() => {
      applyScrollTop(previous.scroll)
      requestAnimationFrame(() => applyScrollTop(previous.scroll))
    })
    return
  }
  const target = homeScrollTop
  await closeFamily()
  await nextTick()
  applyScrollTop(target)
  // Virtual spacer height may settle one frame later; re-apply so the browser does not clamp to 0.
  requestAnimationFrame(() => {
    applyScrollTop(target)
    requestAnimationFrame(() => applyScrollTop(target))
  })
}

watch(selectedFamily, value => {
  selectedFamilyHolder.value = value
  if (value) {
    headerFamilyName.value = value
    headerFamilyCount.value = familyFaces.value.length
  }
}, { immediate: true })

watch(familyFaces, facesList => {
  if (selectedFamily.value && facesList.length) headerFamilyCount.value = facesList.length
})

watch(selectedFolder, async () => {
  familyHistory.value = []
  if (selectedFamily.value) void closeFamily()
  contentBodyRef.value?.scrollTo({ top: 0 })
  await nextTick()
  contentBodyRef.value?.scrollTo({ top: 0 })
})

const { contextMenu, closeContextMenu, runContextAction } = useContextMenu(setError, {
  editNote: (rootId, path) => editFolderNote(rootId, path),
  editTags: () => settings.openSettings('tags'),
  rescan: (rootId, path) => void rescanFolder(rootId, path),
  removeRoot: rootId => {
    const root = roots.value.find(item => item.id === rootId)
    if (root) removeRoot(root)
  },
  viewCharset: (source, key, title) => {
    void fontDetailPanelsRef.value?.openCharsetViewer(source, key, title)
  },
  similarFontAction: (action, sourceFaceId, targetFaceId) => {
    if (action === 'copy-name') {
      fontDetailPanelsRef.value?.copySimilarFaceName(targetFaceId)
      return
    }
    return fontDetailPanelsRef.value?.addSimilarFaceLink(sourceFaceId, targetFaceId)
  },
})

const {
  loaded,
  failed,
  renderedPreviewText,
  coversPreview,
  observePreview,
  leavePreview,
  clearPreviewCache,
  pruneToFaces,
  setupObserver,
  disconnectObserver,
  refreshVisiblePreviews,
  refreshLoadedPreviewTexts,
} = useFontPreview(
  api,
  previewFaces,
  settings.previewText,
  settings.lazyPreview,
  settings.familyNameMode,
  settings.prefetchAhead,
  settings.previewCacheMax,
  settings.fullPreview,
  settings.fullPreviewConcurrent,
)

/** Home list: hide as soon as preview proves missing glyphs. */
const listFaces = computed(() => {
  if (selectedFamily.value) return familyFaces.value
  if (!coversPreviewText.value || !settings.previewText.value.trim()) return faces.value
  return faces.value.filter(face => coversPreview.value.get(face.id) !== false)
})

// Coverage filtering is resolved client-side, so its final count is not known to the database.
const virtualListCount = computed(() => {
  if (selectedFamily.value || (coversPreviewText.value && settings.previewText.value.trim())) return listFaces.value.length
  return Math.max(listFaces.value.length, totalFaces.value)
})

onFacesLoaded = (facesList, meta) => {
  // Search / filter: drop only faces that left the result set; keep still-matching cache.
  if (meta?.replace) pruneToFaces(facesList)
  else refreshVisiblePreviews(facesList)
}

const {
  settingsOpen,
  language,
  settingsReady,
  previewPreset,
  customPreviewText,
  previewPresetTexts,
  defaultPreviewText,
  previewText,
  defaultPreviewFontSize,
  previewFontSize,
  pendingPreviewFontSize,
  homeViewMode,
  detailViewMode,
  defaultHomeViewMode,
  defaultDetailViewMode,
  groupByFamily,
  showOpenFamilyButton,
  defaultGridMinCol,
  gridMinCol,
  lazyPreview,
  prefetchAhead,
  previewCacheMax,
  fullPreview,
  fullPreviewConcurrent,
  uiFont,
  monoFont,
  familyNameMode,
  similarityMode,
  copyNameType,
  copyNameLanguage,
  minimizeToTray,
  theme,
  commonTags,
  sidebarCollapsed,
  defaultSidebarCollapsed,
  showSidebarTagline,
  sidebarWidth,
  settingsFocus,
  viewMode,
  persistSettings,
  resetSettings,
  setDefaultPreviewPreset,
  setDefaultPreviewText,
  schedulePreviewFontSize,
  applyPreviewFontSize,
  scheduleDefaultPreviewFontSize,
  applyDefaultPreviewFontSize,
  toggleViewMode,
  openSettings,
  closeSettings,
  handleSettingsKeydown,
  clearPreviewFontSizeTimer,
  clearSettingsReadyTimer,
  disposeSettings,
} = settings

const listEnabled = computed(() => !selectedFamily.value || activeDetailTab.value === 'preview')
const listScrollRoot = computed(() => {
  if (selectedFamily.value && activeDetailTab.value === 'preview') {
    return fontDetailPanelsRef.value?.scrollEl ?? null
  }
  return contentBodyRef.value
})
const {
  visibleItems,
  spacerStyle,
  windowStyle,
  gridStyle,
  rowHeight,
  totalHeight,
  endIndex: visibleEndIndex,
  measure: measureVirtualList,
} = useVirtualList(listFaces, {
  scrollRoot: listScrollRoot,
  viewMode,
  previewFontSize,
  gridMinCol,
  totalItems: virtualListCount,
  enabled: listEnabled,
})

watch(
  [
    visibleEndIndex,
    () => listFaces.value.length,
    hasMore,
    loadingMore,
  ],
  ([endIndex, faceCount, more, loadingMoreNow]) => {
    if (!selectedFamily.value && more && !loadingMoreNow && endIndex >= faceCount - QUERY_PREFETCH_AHEAD) {
      void loadMore()
    }
  },
)

const quitConfirmOpen = ref(false)

async function closeWindow(action: 'quit' | 'tray') {
  quitConfirmOpen.value = false
  try {
    await api.window.confirmClose(action)
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : action === 'tray' ? t('ui.couldNotMinimizeToTray') : t('ui.couldNotCloseApplication'))
  }
}

function requestClose() {
  if (minimizeToTray.value) {
    void closeWindow('tray')
    return
  }
  quitConfirmOpen.value = true
}

function cancelQuit() {
  quitConfirmOpen.value = false
}

function confirmQuit() {
  void closeWindow('quit')
}

function minimizeQuitToTray() {
  void closeWindow('tray')
}

async function handleToggleRootVisibility(root: Parameters<typeof toggleRootVisibility>[0]) {
  await toggleRootVisibility(root, () => refresh())
}

async function handleToggleFolderVisibility(...args: Parameters<typeof toggleFolderVisibility>) {
  await toggleFolderVisibility(args[0], args[1], () => refresh())
}

async function handleConfirmRemoveRoot() {
  await confirmRemoveRoot(async () => {
    await Promise.all([refresh(), refreshRoots()])
  })
}

function handleResetSettings() {
  resetSettings()
}

function handleReloadApp() {
  void api.window.reloadApp()
}

async function handleRebuildDatabase() {
  error.value = ''
  try {
    await api.library.rebuildDatabase()
    selectedFamily.value = null
    await Promise.all([refresh(), refreshRoots()])
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('ui.couldNotRebuildDatabase')
  }
}

function refreshLibrary() {
  void refreshRoots()
}

function refreshIndex() {
  if (selectedFamily.value) void refreshFamilyFaces(selectedFamily.value)
  else void refresh({ soft: true })
}

async function handleAddRoot() {
  error.value = ''
  await addRoot()
}

function setLibraryView(view: LibraryView) {
  libraryView.value = view
  familyHistory.value = []
  if (selectedFamily.value) void closeFamily()
}

const hasSearchOrFilters = computed(() =>
  Boolean(
    text.value.trim()
    || weight.value
    || italic.value
    || variable.value
    || languages.value.length
    || filterTags.value.length
    || formats.value.length
    || glyphCountMin.value !== null
    || glyphCountMax.value !== null
    || coversPreviewText.value
    || selectedFolder.value,
  ),
)

const listPending = computed(() => loading.value || familyLoading.value)

const homeEmptyMessage = computed(() => {
  if (listPending.value) return ''
  // Coverage filter hides cards after preview load — wait until none remain visible.
  if (listFaces.value.length) return ''
  if (coversPreviewText.value && faces.value.length) {
    return t('ui.noFontsContainAllCharactersInTheCurrentPreviewText')
  }
  if (faces.value.length) return ''
  if (hasSearchOrFilters.value) {
    if (text.value.trim()) return t('ui.noFontsMatchTheCurrentSearch')
    return t('ui.noFontsMatchTheCurrentFilters')
  }
  if (libraryView.value === 'favorites') return t('ui.noFavoriteFontsYet')
  if (libraryView.value === 'active') return t('ui.noActiveFonts')
  if (libraryView.value === 'inactive') return t('ui.noInactiveFonts')
  if (!roots.value.length) return t('ui.addAFontFolderToSeeScanResultsHere')
  return t('ui.thereAreNoVisibleFontsInThisFolder')
})

watch(previewText, () => {
  // Session-only; defaults are persisted from settings separately.
  refreshLoadedPreviewTexts()
})

watch(previewFontSize, async () => {
  await nextTick()
  relayoutList()
})

watch([selectedFamily, activeDetailTab, () => listFaces.value.length, viewMode, coversPreview], async () => {
  await nextTick()
  relayoutList()
})

// Spacer height drives scrollHeight; sync custom scrollbar whenever virtual extent changes.
watch(totalHeight, async () => {
  await nextTick()
  relayoutList()
})

watch(filtersOpen, value => {
  if (value) void refreshAvailableTags()
})

onMounted(async () => {
  if (!api) {
    error.value = t('ui.applicationServicesAreUnavailableStartFontralFromTheDesktopAppInsteadOfOpeningThisPageInABrowser')
    return
  }
  setupObserver(contentBodyRef.value)
  window.addEventListener('library:changed', refreshLibrary)
  window.addEventListener('fonts:index-changed', refreshIndex)
  window.addEventListener('activation:status', handleActivationStatus)
  window.addEventListener('keydown', handleSettingsKeydown)
  window.addEventListener('window:close-requested', requestClose)
  await initializeActivation()
  await Promise.all([refresh(), refreshRoots(), refreshAvailableTags()])
  await nextTick()
  measureVirtualList()
  syncPageScrollbar()
})

onBeforeUnmount(() => {
  clearPreviewFontSizeTimer()
  clearSettingsReadyTimer()
  disposeSettings()
  window.removeEventListener('library:changed', refreshLibrary)
  window.removeEventListener('fonts:index-changed', refreshIndex)
  window.removeEventListener('activation:status', handleActivationStatus)
  window.removeEventListener('keydown', handleSettingsKeydown)
  window.removeEventListener('window:close-requested', requestClose)
  disconnectObserver()
  persistSettings()
})
</script>

<template>
  <div class="app-shell" @click="closeContextMenu">
    <AppTitlebar :sidebar-collapsed="sidebarCollapsed" :api="api"
      @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed" />
    <main :class="{ 'sidebar-collapsed': sidebarCollapsed }" :style="{ '--sidebar-width': `${sidebarWidth}px` }">
      <AppSidebar ref="sidebarRef" :roots="roots" :selected-folder="selectedFolder" :library-view="libraryView"
        :is-expanded="isExpanded" :show-tagline="showSidebarTagline" @add-root="handleAddRoot" @open-settings="openSettings"
        @toggle-visibility="handleToggleRootVisibility" @select-folder="selectFolder" @toggle-expand="toggleExpanded"
        @toggle-folder-visibility="handleToggleFolderVisibility"
        @clear-folder="clearFolderSelection" @set-library-view="setLibraryView" @resize="sidebarWidth = $event" />
      <section class="content" :class="`content--${viewMode}`">
        <header :class="{ 'family-header': Boolean(selectedFamily) }">
          <div class="header-top">
            <Transition
              :css="false"
              @after-leave="!selectedFamily && ((headerFamilyName = null), (headerFamilyCount = 0))"
            >
              <div v-if="!selectedFamily" key="search" class="search-row">
                <AppInput
                  v-model="text"
                  class="search-field"
                  autofocus
                  clearable
                  :clear-label="t('ui.clearSearch')"
                  :clear-tooltip="t('ui.commonClear')"
                  :placeholder="t('ui.searchFontNamesOrNotes')"
                  :aria-label="t('ui.searchFonts')"
                >
                  <template #leading>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="11" cy="11" r="6.5" />
                      <path d="m16 16 4 4" />
                    </svg>
                  </template>
                </AppInput>
                <AdvancedFilters
                  v-model:weight="weight"
                  v-model:italic="italic"
                  v-model:variable="variable"
                  v-model:languages="languages"
                  v-model:tags="filterTags"
                  v-model:formats="formats"
                  v-model:glyph-count-min="glyphCountMin"
                  v-model:glyph-count-max="glyphCountMax"
                  v-model:covers-preview-text="coversPreviewText"
                  v-model:open="filtersOpen"
                  :available-tags="availableTags"
                  :common-tags="commonTags"
                />
              </div>
              <div v-else key="family" class="family-heading">
                <AppButton size="lg" :label="t('ui.backToList')" :tooltip="t('ui.backToList')" @click="handleCloseFamily">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m12.25 5-7 7 7 7" />
                    <path d="M5.75 12h13" />
                  </svg>
                </AppButton>
                <div class="family-title-row">
                  <h2 :data-tooltip="headerFamilyName || undefined">{{ headerFamilyName }}</h2>
                  <AppButton variant="ghost" size="sm" :label="copiedName === headerFamilyName ? t('ui.copied') : t('ui.copyFamilyName')"
                    :tooltip="copiedName === headerFamilyName ? t('ui.copied') : t('ui.copyFamilyName')"
                    @click="headerFamilyName && copyName(headerFamilyName)">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="8" y="8" width="11" height="11" rx="1" />
                      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
                    </svg>
                  </AppButton>
                  <p class="family-count">{{ t('sidebar.familyCount', { count: headerFamilyCount }) }}</p>
                </div>
              </div>
            </Transition>
          </div>
          <PreviewControls v-model:preview-text="previewText" v-model:pending-preview-font-size="pendingPreviewFontSize" v-model:grid-min-col="gridMinCol"
            :view-mode="viewMode" :preview-preset="previewPreset" :custom-preview-text="customPreviewText"
            :preview-preset-texts="previewPresetTexts"
            @schedule-font-size="schedulePreviewFontSize" @apply-font-size="applyPreviewFontSize"
            @toggle-view="toggleViewMode" />
        </header>
        <div class="content-scroll">
          <div ref="contentBodyRef" class="content-body" :class="{ 'content-body--detail': Boolean(selectedFamily) }">
              <div class="content-results">
            <template v-if="selectedFamily">
              <FontDetailPanels ref="fontDetailPanelsRef" v-model:active-detail-tab="activeDetailTab"
                v-model:selected-detail-face-id="selectedDetailFaceId" v-model:detail-note="detailNote"
                v-model:detail-tags="detailTags" v-model:detail-language="detailLanguage"
                :detail-tabs="detailTabs" :family-faces="familyFaces"
                :detail-loading="detailLoading" :selected-detail="selectedDetail" :available-tags="availableTags"
                 :preview-text="previewText"
                 :preview-font-size="previewFontSize" :view-mode="viewMode" :grid-min-col="gridMinCol"
                 :common-tags="commonTags" :note-save-status="noteSaveStatus" :family-name-mode="familyNameMode" :similarity-mode="similarityMode"
                :link-query-input="queryInput" :linked-display-query="linkedDisplayQuery"
                 @copy-name="copyName" @save-note="saveDetailNote" @save-language="saveDetailLanguage"
                 @copy-face-name="face => copyFaceName(face, copyNameType, copyNameLanguage)"
                 @open-tag-settings="openSettings('tags')"
                 @open-family="handleOpenFamily"
                 @error="setError"
              >
                <p v-if="error" class="error">{{ error }}</p>
                <p v-else-if="(loading || familyLoading) && !displayedFaces.length" class="muted status">{{ t('ui.commonLoading') }}</p>
                <p v-else-if="!familyFaces.length" class="empty">{{ t('ui.thisFontFamilyHasNoVisibleFonts') }}</p>
                <template v-else>
                  <div
                    ref="listSpacerRef"
                    class="font-list-virtual"
                    :style="{ ...spacerStyle, '--virtual-row-height': `${rowHeight}px` }"
                  >
                    <div class="font-list" :style="{ ...windowStyle, ...gridStyle }">
                      <FontCard
                        v-for="entry in visibleItems"
                        :key="entry.item.id"
                        mode="family"
                        :face="entry.item"
                        :loaded="loaded.has(entry.item.id)"
                        :preview-error="failed.get(entry.item.id)"
                        :preview-text="previewText"
                        :preview-font-size="previewFontSize"
                        :rendered-text="renderedPreviewText.get(entry.item.id)"
                        :copied-family="copiedFamily"
                        :copied-name="copiedName"
                        :active="activeFaceIds.has(entry.item.id)"
                        :activating="activatingFaceIds.has(entry.item.id)"
                        :family-fallback="selectedFamily"
                        :family-name-mode="familyNameMode"
                        :copy-name-value="resolveCopyName(entry.item, copyNameType, copyNameLanguage, selectedDetail?.id === entry.item.id ? selectedDetail : null)"
                        @observe="observePreview"
                        @leave="leavePreview"
                        @copy-family="face => copyFamilyName(face, familyNameMode)"
                        @copy-name="face => copyFaceName(face, copyNameType, copyNameLanguage)"
                        @open-family="handleOpenFamily"
                        @activate="toggleActivation"
                        @favorite="toggleFavorite"
                      />
                    </div>
                  </div>
                </template>
              </FontDetailPanels>
            </template>
            <template v-else>
              <p v-if="error" class="error">{{ error }}</p>
              <p v-else-if="listPending && !listFaces.length" class="muted status">{{ t('ui.commonLoading') }}</p>
              <p v-else-if="homeEmptyMessage" class="empty">{{ homeEmptyMessage }}</p>
              <template v-else>
                <div
                  ref="listSpacerRef"
                  class="font-list-virtual"
                  :style="{ ...spacerStyle, '--virtual-row-height': `${rowHeight}px` }"
                >
                  <div class="font-list" :style="{ ...windowStyle, ...gridStyle }">
                    <FontCard
                      v-for="entry in visibleItems"
                      :key="entry.item.id"
                      mode="home"
                      :face="entry.item"
                      :loaded="loaded.has(entry.item.id)"
                      :preview-error="failed.get(entry.item.id)"
                      :preview-text="previewText"
                      :preview-font-size="previewFontSize"
                      :rendered-text="renderedPreviewText.get(entry.item.id)"
                      :copied-family="copiedFamily"
                      :copied-name="copiedName"
                      :active="activeFaceIds.has(entry.item.id)"
                      :activating="activatingFaceIds.has(entry.item.id)"
                       :family-fallback="selectedFamily"
                       :family-name-mode="familyNameMode"
                       :copy-name-value="resolveCopyName(entry.item, copyNameType, copyNameLanguage)"
                       :show-open-family-button="showOpenFamilyButton"
                      @observe="observePreview"
                      @leave="leavePreview"
                        @copy-family="face => copyFaceName(face, copyNameType, copyNameLanguage)"
                      @copy-name="face => copyFaceName(face, copyNameType, copyNameLanguage)"
                      @open-family="handleOpenFamily"
                      @activate="toggleActivation"
                      @favorite="toggleFavorite"
                    />
                  </div>
                </div>
                <div v-if="hasMore || loadingMore" class="load-more" aria-live="polite">
                  <span class="muted">{{ loadingMore ? t('library.loadingMore', { count: faces.length }) : t('ui.keepScrollingToLoadMoreFonts') }}</span>
                </div>
              </template>
            </template>
              </div>
          </div>
          <FancyScrollbar
            v-if="!selectedFamily"
            ref="pageScrollbar"
            :target="contentBodyRef"
            :observe="[listSpacerRef]"
            :aria-label="t('ui.pageScrollbar')"
          />
        </div>
      </section>
    </main>
    <AppModals v-model:root-note="rootNote" v-model:language="language" v-model:default-preview-text="defaultPreviewText"
      v-model:default-preview-font-size="defaultPreviewFontSize" v-model:lazy-preview="lazyPreview"
      v-model:prefetch-ahead="prefetchAhead" v-model:preview-cache-max="previewCacheMax"
       v-model:full-preview="fullPreview" v-model:full-preview-concurrent="fullPreviewConcurrent"
       v-model:ui-font="uiFont" v-model:mono-font="monoFont"
        v-model:default-sidebar-collapsed="defaultSidebarCollapsed"
        v-model:show-sidebar-tagline="showSidebarTagline"
        v-model:default-home-view-mode="defaultHomeViewMode" v-model:default-detail-view-mode="defaultDetailViewMode"
        v-model:group-by-family="groupByFamily"
        v-model:show-open-family-button="showOpenFamilyButton"
       v-model:default-grid-min-col="defaultGridMinCol"
       v-model:family-name-mode="familyNameMode" v-model:similarity-mode="similarityMode" v-model:copy-name-type="copyNameType"
      v-model:copy-name-language="copyNameLanguage"
      v-model:minimize-to-tray="minimizeToTray" v-model:theme="theme" v-model:common-tags="commonTags"
      :custom-preview-text="customPreviewText"
      :preview-preset-texts="previewPresetTexts"
      :preview-preset="previewPreset"
      :context-menu="contextMenu"
      :root-to-remove="rootToRemove"
      :root-to-edit-note="folderToEditNote" :settings-open="settingsOpen" :settings-ready="settingsReady"
      :settings-focus="settingsFocus"
      :settings-body-ref="settingsBodyRef" :quit-confirm-open="quitConfirmOpen" @context-action="runContextAction"
      @cancel-remove="rootToRemove = null" @confirm-remove="handleConfirmRemoveRoot"
      @cancel-note="folderToEditNote = null" @save-note="saveFolderNote" @close-settings="closeSettings"
      @schedule-default-font-size="scheduleDefaultPreviewFontSize" @apply-default-font-size="applyDefaultPreviewFontSize"
      @set-default-preview-preset="setDefaultPreviewPreset"
      @set-default-preview-text="setDefaultPreviewText"
      @clear-cache="clearPreviewCache" @reload-app="handleReloadApp" @reset-settings="handleResetSettings"
      @rebuild-database="handleRebuildDatabase"
      @set-settings-body="setSettingsBody"
      @cancel-quit="cancelQuit" @confirm-quit="confirmQuit" @minimize-to-tray="minimizeQuitToTray" />
  </div>
</template>

<style scoped>
.app-shell {
  height: 100vh;
  overflow: hidden;
  color: var(--ink);
  background-color: var(--bg);
}

main {
  --sidebar-width: 292px;
  position: relative;
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  height: calc(100vh - 42px);
  overflow: hidden;
}

main.sidebar-collapsed {
  grid-template-columns: 0 minmax(0, 1fr);
}

main.sidebar-collapsed :deep(aside) {
  pointer-events: none;
  transform: translateX(calc(-1 * var(--sidebar-width)));
}

.muted {
  color: var(--ink-5);
}

.error {
  color: var(--danger-ink);
}

.status,
.empty {
  margin-top: 48px;
  text-align: center;
}

.empty {
  color: var(--ink-4);
}

.content {
  --content-gutter: 34px;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 0;
  background-color: var(--bg);
  overflow: hidden;
}

.content-scroll {
  position: relative;
  flex: 1;
  min-height: 0;
}

.content-body {
  position: relative;
  height: 100%;
  min-height: 0;
  padding: 2px var(--content-gutter) 28px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}

.content-body--detail {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-right: 0;
  padding-bottom: 0;
}

.content-body--detail > .content-results {
  display: flex;
  flex: 1;
  min-height: 0;
}

.content-body--detail :deep(.detail-root) {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.content-body--detail :deep(.detail-navigation),
.content-body--detail :deep(.detail-scroll) {
  padding-right: var(--content-gutter);
}

.content-body::-webkit-scrollbar {
  display: none;
}

.content header {
  position: relative;
  z-index: 20;
  flex: none;
  display: block;
  isolation: isolate;
  margin: 0;
  padding: 18px var(--content-gutter) 16px;
  background-color: var(--bg);
}

.content header::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  border-bottom: 1px solid var(--header-line);
  background-color: var(--bg-soft);
  box-shadow: var(--shadow-sm);
  content: "";
}

.header-top {
  position: relative;
  width: 100%;
  height: 40px;
  overflow: visible;
}

.search-row,
.family-heading {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 40px;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-row .search-field {
  flex: 1;
}

.family-header {
  display: block !important;
  min-height: 0;
}

.family-heading {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.header-to-detail-enter-active,
.header-to-detail-leave-active,
.header-to-home-enter-active,
.header-to-home-leave-active {
  transition: opacity .2s ease, transform .2s ease, filter .2s ease;
  will-change: opacity, transform, filter;
}

.header-to-detail-enter-from {
  opacity: 0;
  filter: blur(3px);
  transform: translateX(10px);
}

.header-to-detail-leave-to {
  opacity: 0;
  filter: blur(3px);
  transform: translateX(-8px);
}

.header-to-home-enter-from {
  opacity: 0;
  filter: blur(3px);
  transform: translateX(-10px);
}

.header-to-home-leave-to {
  opacity: 0;
  filter: blur(3px);
  transform: translateX(8px);
}

.family-heading :deep(.app-button--lg) {
  width: 40px;
  height: 40px;
}

.family-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.family-heading h2 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 27px;
  font-variant: normal;
  line-height: 40px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.family-count {
  flex: none;
  margin: 0;
  overflow: hidden;
  color: var(--ink-5);
  font-size: 12px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.font-list-virtual {
  margin-top: 24px;
  border-top: 1px solid var(--line-3);
  padding-bottom: 18px;
}

.font-list {
  width: 100%;
}

.font-list :deep(.face) {
  box-sizing: border-box;
  height: var(--virtual-row-height);
  min-height: var(--virtual-row-height);
  overflow: hidden;
}

.load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  margin-top: 8px;
  padding: 8px 0;
  font-size: 12px;
}

.content--grid .font-list {
  gap: 4px;
}

.content--grid :deep(.face) {
  align-items: start;
  min-width: 0;
  padding: 13px 14px;
}

.content--grid :deep(.face > div:first-child) {
  min-width: 0;
  overflow: hidden;
}

.content--grid :deep(.family-link),
.content--grid :deep(.face > div:first-child > span) {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content--grid :deep(.face-preview-wrap) {
  min-height: calc(1.35em + 10px);
}

.content--grid :deep(.face-preview) {
  padding: 5px 0;
}

.content--grid :deep(.face-actions) {
  gap: 4px;
  align-self: start;
  justify-content: flex-end;
}

.content--grid :deep(.face-actions .app-button) {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
}

.content--grid :deep(.face-actions .app-button svg) {
  width: 15px;
  height: 15px;
}

.content--grid :deep(.face-actions .favorite-button svg) {
  width: 17px;
  height: 17px;
}

@media (max-width: 900px) {
  .search-row {
    flex-wrap: nowrap;
  }

  .search-row .search-field {
    min-width: 0;
  }
}

@media (max-width: 780px) {
  :global(body),
  .app-shell {
    height: auto;
    overflow: auto;
  }

  main {
    --sidebar-width: 240px;
    grid-template-columns: 1fr;
    height: auto;
    overflow: visible;
  }

  .content,
  .content-scroll,
  .content-body {
    overflow: visible;
  }

  .content {
    --content-gutter: 20px;
    height: auto;
  }

  .content header {
    padding: 22px var(--content-gutter) 16px;
  }

  .content-body {
    height: auto;
    padding: 2px var(--content-gutter) 22px;
  }

  .family-heading h2 {
    font-size: 22px;
  }

  .family-title-row {
    gap: 8px;
  }

  .family-count {
    max-width: 70px;
  }

  .content--grid .font-list {
    grid-template-columns: 1fr;
  }
}
</style>
