<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FAMILY_TAGS_MAX, FONT_LANGUAGES, TAG_NAME_MAX, type FontFaceDetail, type FontFaceSummary, type FontLanguage, type FontQuery, type SimilarFontFamily, type SimilarityMode } from '@fontral/contracts'
import AppInput from './AppInput.vue'
import CustomSelect from './CustomSelect.vue'
import FancyScrollbar from './FancyScrollbar.vue'
import SegmentedControl from './SegmentedControl.vue'
import FontFamilyPreviewCard from './FontFamilyPreviewCard.vue'
import AppConfirmDialog from './AppConfirmDialog.vue'
import CharsetViewerModal from './CharsetViewerModal.vue'
import FontPropertiesPanel from './FontPropertiesPanel.vue'
import type { FamilyNameMode } from '../composables/useSettings'
import { displayFamily, displaySubfamily } from '../composables/useFonts'
import { fontPreviewSource } from '../composables/useFontPreview'
import { translateExternal, useI18n } from '../composables/useI18n'

type CharsetViewMode = 'unicode' | 'cjk'

/** Main process replaces missing glyphs with this noncharacter in previewText(). */
const MISSING_GLYPH = '\uFDD0'

const { t } = useI18n()

const charsetViewMode = ref<CharsetViewMode>('unicode')
const charsetViewOptions = computed(() => [
  { label: t('ui.unicodeBlocks2'), value: 'unicode' as const },
  { label: t('ui.cjkCharacterCount'), value: 'cjk' as const },
])

const charsetModalRef = ref<InstanceType<typeof CharsetViewerModal> | null>(null)

function openCharsetViewer(source: 'unicode' | 'cjk', key: string, title: string) {
  charsetModalRef.value?.open(source, key, title)
}

const detailScrollRef = ref<HTMLElement | null>(null)

defineExpose({
  openCharsetViewer,
  copySimilarFaceName,
  addSimilarFaceLink,
  scrollEl: detailScrollRef,
})

const DETAIL_TAB_ORDER = ['preview', 'properties', 'charset', 'notes', 'similar'] as const
type DetailTabId = (typeof DETAIL_TAB_ORDER)[number]

const activeDetailTab = defineModel<DetailTabId>('activeDetailTab', { required: true })
const selectedDetailFaceId = defineModel<number | null>('selectedDetailFaceId', { required: true })
const detailNote = defineModel<string>('detailNote', { required: true })
const detailTags = defineModel<string[]>('detailTags', { required: true })
const detailLanguage = defineModel<FontLanguage | null>('detailLanguage', { required: true })
const tabTransitionName = ref<'detail-tab-next' | 'detail-tab-prev'>('detail-tab-next')
const detailTabScrollTops: Record<DetailTabId, number> = {
  preview: 0,
  similar: 0,
  properties: 0,
  charset: 0,
  notes: 0,
}

const props = defineProps<{
  detailTabs: Array<{ id: 'preview' | 'similar' | 'properties' | 'charset' | 'notes'; label: string }>
  familyFaces: FontFaceSummary[]
  detailLoading: boolean
  selectedDetail: FontFaceDetail | null
  availableTags: string[]
  commonTags: string[]
  noteSaveStatus: 'idle' | 'saving' | 'saved'
  familyNameMode: FamilyNameMode
  similarityMode: SimilarityMode
  previewText: string
  previewFontSize: number
  viewMode: 'grid' | 'list'
  gridMinCol: number
  linkQueryInput?: (cursor?: number, options?: { includeTotal?: boolean; limit?: number }) => FontQuery
  linkedDisplayQuery?: (linkedIds: number[], cursor?: number, options?: { includeTotal?: boolean; limit?: number }) => FontQuery
}>()

const emit = defineEmits<{
  'copy-name': [value: string]
  'copy-face-name': [face: FontFaceSummary]
  'save-note': []
  'save-language': [language: FontLanguage | null]
  'open-tag-settings': []
  error: [message: string]
  'open-family': [family: string]
}>()

const similarFamilies = ref<SimilarFontFamily[]>([])
const similarLoading = ref(false)
const similarError = ref('')
let similarLoadSeq = 0
const similarPreviewFonts = ref(new Map<number, string>())
const similarPreviewErrors = ref(new Set<number>())
const similarRenderedText = ref(new Map<number, string>())
let similarPreviewGeneration = 0
let similarLoadedTextKey = ''
const displayedSimilarFamilies = computed(() => {
  const families = new Set<string>()
  return similarFamilies.value.filter(face => {
    const name = displayFamily(face, props.familyNameMode)
    if (families.has(name)) return false
    families.add(name)
    return true
  }).slice(0, 30)
})

const detailCardGridStyle = computed(() => props.viewMode === 'grid'
  ? { gridTemplateColumns: `repeat(auto-fill, minmax(${props.gridMinCol}px, 1fr))` }
  : undefined)

function previewSourceKey() {
  return `${props.previewText}\0${props.familyNameMode}`
}

function dropSimilarPreviewFonts() {
  for (const font of [...document.fonts]) {
    if (!font.family.startsWith('fontral_sim_')) continue
    try { document.fonts.delete(font) } catch { /* ignore */ }
  }
  similarPreviewFonts.value = new Map()
  similarPreviewErrors.value = new Set()
  similarRenderedText.value = new Map()
}

/** Map preview text through the font's cmap so missing glyphs use .notdef (like home page). */
async function resolveMappedText(faceId: number, source: string) {
  try {
    return await window.fontral.fonts.previewText(faceId, source)
  } catch {
    return source
  }
}

async function loadSimilarPreviews(faces: SimilarFontFamily[], seq: number, force = false) {
  let next = 0
  const loadOne = async () => {
    while (next < faces.length) {
      const face = faces[next++]!
      if (!force && similarPreviewFonts.value.has(face.id)) continue
      const family = `fontral_sim_${face.id}_${similarPreviewGeneration}`
      const source = props.previewText || displayFamily(face, props.familyNameMode)
      try {
        const mapped = await resolveMappedText(face.id, source)
        const needed = mapped.split(MISSING_GLYPH).join('') || ' '
        const loaded = await new FontFace(family, fontPreviewSource(face, needed)).load()
        if (seq !== similarLoadSeq) continue
        document.fonts.add(loaded)
        similarPreviewFonts.value = new Map(similarPreviewFonts.value).set(face.id, family)
        similarRenderedText.value = new Map(similarRenderedText.value).set(face.id, mapped)
        similarPreviewErrors.value = new Set([...similarPreviewErrors.value].filter(id => id !== face.id))
      } catch {
        if (seq === similarLoadSeq) similarPreviewErrors.value = new Set(similarPreviewErrors.value).add(face.id)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, faces.length) }, loadOne))
}

async function loadSimilarFamilies(options?: { background?: boolean }) {
  const faceId = props.selectedDetail?.id
  if (!faceId) return
  const seq = ++similarLoadSeq
  const initialLoad = !similarFamilies.value.length
  if (!options?.background || initialLoad) similarLoading.value = true
  similarError.value = ''
  try {
    const results = await window.fontral.fonts.similar(faceId, props.similarityMode)
    if (seq === similarLoadSeq) {
      similarFamilies.value = results
      similarLoadedTextKey = previewSourceKey()
      void loadSimilarPreviews(displayedSimilarFamilies.value, seq)
    }
  } catch (cause) {
    if (seq === similarLoadSeq) similarError.value = cause instanceof Error ? cause.message : t('ui.couldNotFindSimilarFonts')
  } finally {
    if (seq === similarLoadSeq && (!options?.background || initialLoad)) similarLoading.value = false
  }
}

const linkedFonts = ref<FontFaceSummary[]>([])
const displayedLinkedFonts = ref<FontFaceSummary[]>([])
const linkedLoading = ref(false)
const linkedClearing = ref(false)
const clearLinksConfirmOpen = ref(false)
const linkedError = ref('')
let linkedLoadSeq = 0
let linkedLoadedFamily = ''
let linkedLoadedTextKey = ''
const linkedPreviewFonts = ref(new Map<number, string>())
const linkedPreviewErrors = ref(new Set<number>())
const linkedRenderedText = ref(new Map<number, string>())
const linkPickerOpen = ref(false)
const linkPickerRef = ref<HTMLElement | null>(null)
const linkSearchInputRef = ref<InstanceType<typeof AppInput> | null>(null)
const linkQuery = ref('')
const linkResults = ref<FontFaceSummary[]>([])
const linkSearching = ref(false)
const linkResultsRef = ref<HTMLElement | null>(null)
let linkSearchSeq = 0
let linkSearchTimer: number | undefined
let linkSearchPreviewSeq = 0
let linkPreviewGeneration = 0
const LINK_SEARCH_PAGE_SIZE = 12
const linkSearchPage = ref(1)
const linkSearchCursors = ref<Array<number | undefined>>([undefined])
const linkSearchNextCursor = ref<number | undefined>()

function dropLinkedPreviewFonts() {
  for (const font of [...document.fonts]) {
    if (!font.family.startsWith('fontral_link_')) continue
    try { document.fonts.delete(font) } catch { /* ignore */ }
  }
  linkedPreviewFonts.value = new Map()
  linkedPreviewErrors.value = new Set()
  linkedRenderedText.value = new Map()
}

async function loadLinkedPreviews(faces: FontFaceSummary[], seq: number, force = false) {
  let next = 0
  const loadOne = async () => {
    while (next < faces.length) {
      const face = faces[next++]!
      if (!force && linkedPreviewFonts.value.has(face.id)) continue
      const family = `fontral_link_${face.id}_${linkPreviewGeneration}`
      const source = props.previewText || displayFamily(face, props.familyNameMode)
      try {
        const mapped = await resolveMappedText(face.id, source)
        const needed = mapped.split(MISSING_GLYPH).join('') || ' '
        const loaded = await new FontFace(family, fontPreviewSource(face, needed)).load()
        if (seq !== linkedLoadSeq) continue
        document.fonts.add(loaded)
        linkedPreviewFonts.value = new Map(linkedPreviewFonts.value).set(face.id, family)
        linkedRenderedText.value = new Map(linkedRenderedText.value).set(face.id, mapped)
        linkedPreviewErrors.value = new Set([...linkedPreviewErrors.value].filter(id => id !== face.id))
      } catch {
        if (seq === linkedLoadSeq) linkedPreviewErrors.value = new Set(linkedPreviewErrors.value).add(face.id)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, faces.length) }, loadOne))
}

async function loadLinkSearchPreviews(faces: FontFaceSummary[], seq: number, force = false) {
  let next = 0
  const loadOne = async () => {
    while (next < faces.length) {
      const face = faces[next++]!
      if (!force && linkedPreviewFonts.value.has(face.id)) continue
      const family = `fontral_link_${face.id}_${linkPreviewGeneration}`
      const source = props.previewText || displayFamily(face, props.familyNameMode)
      try {
        const mapped = await resolveMappedText(face.id, source)
        const needed = mapped.split(MISSING_GLYPH).join('') || ' '
        const loaded = await new FontFace(family, fontPreviewSource(face, needed)).load()
        if (seq !== linkSearchPreviewSeq) continue
        document.fonts.add(loaded)
        linkedPreviewFonts.value = new Map(linkedPreviewFonts.value).set(face.id, family)
        linkedRenderedText.value = new Map(linkedRenderedText.value).set(face.id, mapped)
        linkedPreviewErrors.value = new Set([...linkedPreviewErrors.value].filter(id => id !== face.id))
      } catch {
        if (seq === linkSearchPreviewSeq) linkedPreviewErrors.value = new Set(linkedPreviewErrors.value).add(face.id)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, faces.length) }, loadOne))
}

function resetLinkedFamily() {
  linkedLoadedFamily = ''
  linkedLoadedTextKey = ''
  linkedFonts.value = []
  displayedLinkedFonts.value = []
  linkedError.value = ''
  linkPreviewGeneration++
  dropLinkedPreviewFonts()
}

async function refreshDisplayedLinkedFonts() {
  const seq = linkedLoadSeq
  if (!linkedFonts.value.length) {
    displayedLinkedFonts.value = []
    return
  }
  if (!props.linkedDisplayQuery) {
    displayedLinkedFonts.value = linkedFonts.value
    return
  }
  try {
    const query = props.linkedDisplayQuery(
      linkedFonts.value.map(face => face.id),
      undefined,
      { limit: linkedFonts.value.length, includeTotal: false },
    )
    const page = await window.fontral.fonts.query({ ...query, groupByFamily: false })
    if (seq !== linkedLoadSeq) return
    const visible = new Set(page.items.map(face => face.id))
    displayedLinkedFonts.value = linkedFonts.value.filter(face => visible.has(face.id))
  } catch {
    if (seq === linkedLoadSeq) displayedLinkedFonts.value = linkedFonts.value
  }
}

async function loadLinkedFonts() {
  const detail = props.selectedDetail
  if (!detail) return
  const familyKey = detail.preferredFamily || detail.family
  if (linkedLoadedFamily === familyKey) return
  linkedLoadedFamily = familyKey
  const seq = ++linkedLoadSeq
  linkedLoading.value = true
  linkedError.value = ''
  dropLinkedPreviewFonts()
  linkedFonts.value = []
  displayedLinkedFonts.value = []
  try {
    const results = await window.fontral.fonts.listFamilyLinks(detail.id)
    if (seq !== linkedLoadSeq) return
    linkedFonts.value = results
    linkedLoadedTextKey = previewSourceKey()
    if (results.length) {
      void loadLinkedPreviews(results, seq)
      void refreshDisplayedLinkedFonts()
    }
  } catch (cause) {
    if (seq === linkedLoadSeq) linkedError.value = cause instanceof Error ? cause.message : t('ui.couldNotLoadLinkedFonts')
  } finally {
    if (seq === linkedLoadSeq) linkedLoading.value = false
  }
}

const linkedFaceIds = computed(() => new Set(linkedFonts.value.map(face => face.id)))

function currentDetailFamilyName() {
  const detail = props.selectedDetail
  if (!detail) return ''
  return displayFamily(detail, props.familyNameMode)
}

async function searchLinks(text: string, pageNumber = 1, cursor?: number) {
  const seq = ++linkSearchSeq
  linkSearching.value = true
  try {
    const base = props.linkQueryInput
      ? props.linkQueryInput(cursor, { includeTotal: false, limit: LINK_SEARCH_PAGE_SIZE })
      : { cursor, limit: LINK_SEARCH_PAGE_SIZE, includeTotal: false }
    const page = await window.fontral.fonts.query({
      ...base,
      text: text.trim().slice(0, 200),
      groupByFamily: true,
    })
    if (seq !== linkSearchSeq) return
    const current = currentDetailFamilyName()
    const results = page.items.filter(face =>
      displayFamily(face, props.familyNameMode) !== current && !linkedFaceIds.value.has(face.id),
    )
    linkSearchCursors.value[pageNumber - 1] = cursor
    linkSearchCursors.value[pageNumber] = page.nextCursor
    if (!results.length && page.nextCursor) {
      void searchLinks(text, pageNumber + 1, page.nextCursor)
      return
    }
    linkResults.value = results
    linkSearchPage.value = pageNumber
    linkSearchNextCursor.value = page.nextCursor
    const previewSeq = ++linkSearchPreviewSeq
    void loadLinkSearchPreviews(linkResults.value, previewSeq)
    await nextTick()
    linkResultsRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
    scrollLinkPickerIntoView()
  } catch {
    if (seq === linkSearchSeq) {
      linkResults.value = []
      linkSearchPreviewSeq++
      linkSearchNextCursor.value = undefined
    }
  } finally {
    if (seq === linkSearchSeq) linkSearching.value = false
  }
}

watch(linkQuery, value => {
  window.clearTimeout(linkSearchTimer)
  if (!linkPickerOpen.value) return
  linkSearchTimer = window.setTimeout(() => { startLinkSearch(value) }, 180)
})

function startLinkSearch(text = linkQuery.value) {
  linkSearchPage.value = 1
  linkSearchCursors.value = [undefined]
  linkSearchNextCursor.value = undefined
  void searchLinks(text, 1)
}

function goLinkSearchPage(delta: number) {
  const page = linkSearchPage.value + delta
  if (page < 1 || (delta > 0 && !linkSearchNextCursor.value)) return
  void searchLinks(linkQuery.value, page, linkSearchCursors.value[page - 1])
}

function openLinkPicker() {
  if (linkPickerOpen.value) {
    focusLinkSearch()
    scrollLinkPickerIntoView()
    return
  }
  linkQuery.value = ''
  linkResults.value = []
  linkPickerOpen.value = true
  startLinkSearch('')
  void nextTick(() => {
    scrollLinkPickerIntoView()
    focusLinkSearch()
  })
}

function focusLinkSearch() {
  linkSearchInputRef.value?.input?.focus({ preventScroll: true })
}

function scrollLinkPickerIntoView() {
  const scroll = detailScrollRef.value
  if (!scroll) return
  scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' })
}

function closeLinkPicker() {
  linkPickerOpen.value = false
  linkQuery.value = ''
  linkResults.value = []
  linkSearchPreviewSeq++
}

function refreshLinkSearchPreviews() {
  if (!linkPickerOpen.value || !linkResults.value.length) return
  const seq = ++linkSearchPreviewSeq
  void loadLinkSearchPreviews(linkResults.value, seq, true)
}

async function addLink(face: FontFaceSummary) {
  const faceId = props.selectedDetail?.id
  if (!faceId) return
  const pickerTop = linkPickerRef.value?.getBoundingClientRect().top
  try {
    await window.fontral.fonts.addFamilyLink(faceId, face.id)
    if (!linkedFonts.value.some(item => item.id === face.id)) {
      linkedFonts.value = [...linkedFonts.value, face]
      displayedLinkedFonts.value = [...displayedLinkedFonts.value, face]
      void loadLinkedPreviews([face], linkedLoadSeq)
    }
    linkResults.value = linkResults.value.filter(item => item.id !== face.id)
    if (!linkResults.value.length && linkSearchNextCursor.value) goLinkSearchPage(1)
    await nextTick()
    if (pickerTop !== undefined && linkPickerRef.value && detailScrollRef.value) {
      detailScrollRef.value.scrollTop += linkPickerRef.value.getBoundingClientRect().top - pickerTop
    }
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : t('ui.couldNotSaveLink'))
  }
}

function copySimilarFaceName(faceId: number) {
  const face = similarFamilies.value.find(item => item.id === faceId)
  if (face) emit('copy-face-name', face)
}

async function addSimilarFaceLink(sourceFaceId: number, targetFaceId: number) {
  if (props.selectedDetail?.id !== sourceFaceId) return
  const face = similarFamilies.value.find(item => item.id === targetFaceId)
  if (face) await addLink(face)
}

async function removeLink(face: FontFaceSummary) {
  const faceId = props.selectedDetail?.id
  if (!faceId) return
  const previous = linkedFonts.value
  const previousDisplayed = displayedLinkedFonts.value
  linkedFonts.value = previous.filter(item => item.id !== face.id)
  displayedLinkedFonts.value = previousDisplayed.filter(item => item.id !== face.id)
  try {
    await window.fontral.fonts.removeFamilyLink(faceId, face.id)
  } catch (cause) {
    linkedFonts.value = previous
    displayedLinkedFonts.value = previousDisplayed
    emit('error', cause instanceof Error ? cause.message : t('ui.couldNotSaveLink'))
  }
}

async function clearLinks() {
  const detail = props.selectedDetail
  const faces = [...linkedFonts.value]
  if (!detail || !faces.length || linkedClearing.value) return
  clearLinksConfirmOpen.value = false
  linkedClearing.value = true
  linkedFonts.value = []
  displayedLinkedFonts.value = []
  try {
    await Promise.all(faces.map(face => window.fontral.fonts.removeFamilyLink(detail.id, face.id)))
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : t('ui.couldNotSaveLink'))
  } finally {
    linkedClearing.value = false
    linkedLoadedFamily = ''
    await loadLinkedFonts()
    if (linkPickerOpen.value) startLinkSearch()
  }
}

function captureCardLeaveWidth(el: Element) {
  const htmlEl = el as HTMLElement
  const container = htmlEl.closest<HTMLElement>('.detail-family-card-list, .link-search-card-list')
  if (!container) return
  const cardRect = htmlEl.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  htmlEl.style.setProperty('--card-leave-left', `${cardRect.left - containerRect.left}px`)
  htmlEl.style.setProperty('--card-leave-top', `${cardRect.top - containerRect.top}px`)
  htmlEl.style.setProperty('--card-leave-width', `${cardRect.width}px`)
  htmlEl.style.setProperty('--card-leave-height', `${cardRect.height}px`)
}

const sidebarFilterKey = computed(() => {
  if (!props.linkQueryInput) return ''
  const q = props.linkQueryInput()
  return JSON.stringify({
    fav: q.favorite ?? false,
    faceCount: q.faceIds?.length ?? 0,
    excludeCount: q.excludeFaceIds?.length ?? 0,
    rootId: q.rootId ?? 0,
    pathPrefix: q.pathPrefix ?? '',
  })
})

watch(sidebarFilterKey, () => {
  if (activeDetailTab.value !== 'notes') return
  if (linkedFonts.value.length) void refreshDisplayedLinkedFonts()
  if (linkPickerOpen.value) startLinkSearch(linkQuery.value)
})

const languageOptions = computed(() => FONT_LANGUAGES.map(value => ({ label: translateExternal(value), value })))

const languageSelectValue = computed(() =>
  detailLanguage.value ?? props.selectedDetail?.inferredLanguage ?? null
)

const isLanguageManual = computed(() => Boolean(props.selectedDetail?.language))

function onLanguageChange(value: string | number | null) {
  const language = typeof value === 'string' && (FONT_LANGUAGES as readonly string[]).includes(value)
    ? value as FontLanguage
    : null
  if (!language) return
  detailLanguage.value = language
  emit('save-language', language)
}

function restoreInferredLanguage() {
  detailLanguage.value = null
  emit('save-language', null)
}

const cjkCoverageGroups = computed(() => {
  const items = props.selectedDetail?.cjkCoverage ?? []
  const sections: { group: string; label: string; items: typeof items }[] = []
  for (const item of items) {
    let section = sections.find(s => s.group === item.group)
    if (!section) {
      section = { group: item.group, label: item.group, items: [] }
      sections.push(section)
    }
    section.items.push(item)
  }
  return sections
})

const tagDraft = ref('')
const tagInputFocused = ref(false)
const tagSuggestionsRef = ref<HTMLElement | null>(null)
const tagInputRef = ref<InstanceType<typeof AppInput> | null>(null)
const tagPlaceholder = computed(() => detailTags.value.length ? t('ui.addTag') : t('ui.enterATagAndPressEnter2'))

watch(tagPlaceholder, () => {
  const el = tagInputRef.value?.input
  if (!el) return
  el.classList.remove('note-tag-placeholder-pulse')
  void el.offsetWidth
  el.classList.add('note-tag-placeholder-pulse')
})

function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, TAG_NAME_MAX)
}

function hasTag(name: string) {
  const key = name.toLowerCase()
  return detailTags.value.some(tag => tag.toLowerCase() === key)
}

const commonTagItems = computed(() => {
  const selected = new Set(detailTags.value.map(tag => tag.toLowerCase()))
  return props.commonTags.map(tag => ({
    name: tag,
    active: selected.has(tag.toLowerCase()),
  }))
})

const tagSuggestions = computed(() => {
  const draft = normalizeTagName(tagDraft.value).toLowerCase()
  const selected = new Set(detailTags.value.map(tag => tag.toLowerCase()))
  return props.availableTags
    .filter(tag => !selected.has(tag.toLowerCase()))
    .filter(tag => !draft || tag.toLowerCase().includes(draft))
    .slice(0, 10)
})

function toggleCommonTag(name: string) {
  if (hasTag(name)) {
    removeTag(name)
    return
  }
  addTag(name)
}

const canCreateTag = computed(() => {
  const name = normalizeTagName(tagDraft.value)
  if (!name || hasTag(name) || detailTags.value.length >= FAMILY_TAGS_MAX) return false
  return !props.availableTags.some(tag => tag.toLowerCase() === name.toLowerCase())
})

const showTagSuggestions = computed(() => {
  if (!tagInputFocused.value) return false
  return canCreateTag.value || tagSuggestions.value.length > 0
})

function commitTagDraft() {
  const name = normalizeTagName(tagDraft.value)
  if (!name) return false
  if (tagSuggestions.value[0] && tagSuggestions.value[0].toLowerCase().startsWith(name.toLowerCase())) {
    addTag(tagSuggestions.value[0], false)
    return true
  }
  addTag(name, false)
  return true
}

function addTag(raw: string, save = true) {
  const name = normalizeTagName(raw)
  if (!name || hasTag(name) || detailTags.value.length >= FAMILY_TAGS_MAX) return
  detailTags.value = [...detailTags.value, name]
  tagDraft.value = ''
  if (save) emit('save-note')
}

function removeTag(name: string) {
  detailTags.value = detailTags.value.filter(tag => tag !== name)
  emit('save-note')
}

function onTagKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
    const name = normalizeTagName(tagDraft.value)
    if (!name) return
    event.preventDefault()
    commitTagDraft()
    emit('save-note')
    return
  }
  if (event.key === 'Backspace' && !tagDraft.value && detailTags.value.length) {
    removeTag(detailTags.value[detailTags.value.length - 1]!)
  }
  if (event.key === 'Escape') {
    tagInputFocused.value = false
    ;(event.target as HTMLElement | null)?.blur()
  }
}

function onTagBlur() {
  tagInputFocused.value = false
  if (commitTagDraft()) emit('save-note')
}

function onNoteBlur() {
  emit('save-note')
}

const tabsRef = ref<HTMLElement | null>(null)
const indicatorStyle = ref({ width: '0px', transform: 'translateX(0px)' })
let indicatorReady = false

function updateTabIndicator() {
  const nav = tabsRef.value
  if (!nav) return
  const active = nav.querySelector<HTMLElement>('button.active')
  if (!active) {
    indicatorStyle.value = { width: '0px', transform: 'translateX(0px)' }
    return
  }
  indicatorStyle.value = {
    width: `${active.offsetWidth}px`,
    transform: `translateX(${active.offsetLeft}px)`,
  }
  if (!indicatorReady) {
    requestAnimationFrame(() => {
      nav.classList.add('detail-tabs--ready')
      indicatorReady = true
    })
  }
}

function refreshSimilarForIndexChange() {
  if (activeDetailTab.value === 'similar') void loadSimilarFamilies({ background: true })
}

watch([activeDetailTab, () => props.detailTabs], async () => {
  await nextTick()
  updateTabIndicator()
})

watch(activeDetailTab, async (tab, prev) => {
  if (detailScrollRef.value) detailTabScrollTops[prev] = detailScrollRef.value.scrollTop
  const nextIndex = DETAIL_TAB_ORDER.indexOf(tab)
  const prevIndex = DETAIL_TAB_ORDER.indexOf(prev)
  tabTransitionName.value = nextIndex >= prevIndex ? 'detail-tab-next' : 'detail-tab-prev'
  await nextTick()
  if (tab === 'similar') {
    if (similarFamilies.value.length && similarLoadedTextKey && similarLoadedTextKey !== previewSourceKey()) {
      similarLoadedTextKey = previewSourceKey()
      similarPreviewGeneration++
      void loadSimilarPreviews(displayedSimilarFamilies.value, similarLoadSeq, true)
    } else if (!similarFamilies.value.length) {
      void loadSimilarFamilies()
    }
  }
  if (tab === 'notes') {
    if (linkedFonts.value.length && linkedLoadedTextKey && linkedLoadedTextKey !== previewSourceKey()) {
      linkedLoadedTextKey = previewSourceKey()
      linkPreviewGeneration++
      void loadLinkedPreviews(linkedFonts.value, linkedLoadSeq, true)
      refreshLinkSearchPreviews()
    }
    void loadLinkedFonts()
  }
})

function restoreDetailTabScroll() {
  if (detailScrollRef.value) detailScrollRef.value.scrollTop = detailTabScrollTops[activeDetailTab.value]
}

function resetSimilarFamilies() {
  dropSimilarPreviewFonts()
  similarLoadedTextKey = ''
  similarFamilies.value = []
  similarError.value = ''
  if (activeDetailTab.value === 'similar') void loadSimilarFamilies()
}

watch(() => {
  const detail = props.selectedDetail
  return detail ? detail.preferredFamily || detail.family : null
}, () => {
  resetSimilarFamilies()
  resetLinkedFamily()
  if (activeDetailTab.value === 'notes') void loadLinkedFonts()
})

watch(() => props.selectedDetail?.id ?? null, (faceId, previousFaceId) => {
  if (!faceId || faceId === previousFaceId || props.similarityMode !== 'face') return
  resetSimilarFamilies()
})

watch(() => previewSourceKey(), () => {
  if (activeDetailTab.value === 'similar' && similarFamilies.value.length) {
    similarLoadedTextKey = previewSourceKey()
    similarPreviewGeneration++
    void loadSimilarPreviews(displayedSimilarFamilies.value, similarLoadSeq, true)
  }
  if (activeDetailTab.value === 'notes' && (linkedFonts.value.length || linkPickerOpen.value)) {
    linkedLoadedTextKey = previewSourceKey()
    linkPreviewGeneration++
    if (linkedFonts.value.length) {
      void loadLinkedPreviews(linkedFonts.value, linkedLoadSeq, true)
    }
    refreshLinkSearchPreviews()
  }
})

watch(() => props.similarityMode, () => {
  dropSimilarPreviewFonts()
  similarFamilies.value = []
  similarError.value = ''
  if (activeDetailTab.value === 'similar') void loadSimilarFamilies()
})

onMounted(() => {
  updateTabIndicator()
  window.addEventListener('resize', updateTabIndicator)
  window.addEventListener('fonts:index-changed', refreshSimilarForIndexChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateTabIndicator)
  window.removeEventListener('fonts:index-changed', refreshSimilarForIndexChange)
  window.clearTimeout(linkSearchTimer)
  dropSimilarPreviewFonts()
  dropLinkedPreviewFonts()
})
</script>

<template>
  <div class="detail-root">
    <div class="detail-navigation">
      <nav ref="tabsRef" class="detail-tabs" :aria-label="t('ui.fontDetails')">
        <button
          v-for="tab in detailTabs"
          :key="tab.id"
          type="button"
          :class="{ active: activeDetailTab === tab.id }"
          @click="activeDetailTab = tab.id"
        >
          {{ tab.label }}
        </button>
        <span class="detail-tabs-indicator" :style="indicatorStyle" aria-hidden="true" />
      </nav>
      <div class="detail-variant">
        <CustomSelect
          v-model="selectedDetailFaceId"
          :options="familyFaces.map(face => ({ label: `${displaySubfamily(face, familyNameMode)}${face.isVariable ? ` (${t('ui.variable')})` : ''}`, value: face.id }))"
          :ariaLabel="t('ui.chooseFontVariant')"
        />
      </div>
    </div>

    <div class="detail-scroll-wrap">
      <div ref="detailScrollRef" class="detail-scroll">
       <Transition :name="tabTransitionName" mode="out-in" @enter="restoreDetailTabScroll">
       <div :key="activeDetailTab" class="detail-tab-pane">
       <slot v-if="activeDetailTab === 'preview'" />
       <section v-else-if="activeDetailTab === 'similar'" class="detail-panel detail-panel--similar">
           <p class="similar-intro">{{ t(similarityMode === 'face' ? 'ui.compareGlyphOutlineFeaturesByFace' : 'ui.compareGlyphOutlineFeaturesByFontFamily') }}</p>
          <p v-if="similarLoading" class="muted">{{ t('ui.findingSimilarFonts') }}</p>
         <p v-else-if="similarError" class="error">{{ similarError }}</p>
           <p v-else-if="!similarFamilies.length" class="muted">{{ t('ui.similarityFeaturesAreBeingBuiltInTheBackground') }}</p>
          <div v-else class="detail-family-card-list" :class="`detail-family-card-list--${viewMode}`" :style="detailCardGridStyle">
            <FontFamilyPreviewCard
              v-for="face in displayedSimilarFamilies"
              :key="face.id"
              :face="face"
              :family-name-mode="familyNameMode"
              :preview-text="previewText"
              :rendered-text="similarRenderedText.get(face.id)"
              :preview-font-family="similarPreviewFonts.get(face.id)"
              :preview-unavailable="similarPreviewErrors.has(face.id)"
              :preview-font-size="previewFontSize"
               :view-mode="viewMode"
               :score="face.similarity"
               :similar-source-face-id="selectedDetail?.id"
               @open="emit('open-family', $event)"
            />
          </div>
       </section>
       <FontPropertiesPanel
         v-else-if="activeDetailTab === 'properties'"
         :selected-detail="selectedDetail"
         :detail-loading="detailLoading"
         @copy-name="emit('copy-name', $event)"
         @error="emit('error', $event)"
       />

  <section v-else-if="activeDetailTab === 'charset'" class="detail-panel detail-panel--charset">
    <p v-if="detailLoading && !selectedDetail" class="muted">{{ t('ui.loadingCharacterSet') }}</p>
    <template v-else-if="selectedDetail">
      <div class="charset-toolbar">
        <p class="charset-summary">
          <template v-if="charsetViewMode === 'unicode'">
            {{ t('charset.glyphSummary', { glyphs: selectedDetail.glyphCount ?? t('ui.commonUnknown'), blocks: selectedDetail.unicodeBlocks.length }) }}
          </template>
          <template v-else>
            {{ t('charset.cjkSummary', { count: selectedDetail.cjkCharacterCount }) }}
          </template>
        </p>
        <SegmentedControl
          v-model="charsetViewMode"
          class="charset-view-switch"
          :options="charsetViewOptions"
          :ariaLabel="t('ui.characterSetView')"
        />
      </div>

      <div v-if="charsetViewMode === 'unicode'" class="unicode-blocks">
        <article
          v-for="block in selectedDetail.unicodeBlocks"
          :key="block.range"
          data-charset-source="unicode"
          :data-charset-key="block.range"
          :data-charset-title="translateExternal(block.name)"
          :data-tooltip="`${translateExternal(block.name)}\n${block.range}\n${block.codePointCount}/${block.blockTotal}`"
        >
          <span class="unicode-block-name">{{ translateExternal(block.name) }}</span>
          <span class="unicode-block-count">{{ block.codePointCount }}/{{ block.blockTotal }}</span>
        </article>
      </div>

      <div v-else class="cjk-coverage">
        <section v-for="section in cjkCoverageGroups" :key="section.group" class="cjk-coverage-section">
          <h3 class="cjk-coverage-title">{{ translateExternal(section.label) }}</h3>
          <div class="unicode-blocks">
            <article
              v-for="item in section.items"
              :key="item.id"
              data-charset-source="cjk"
              :data-charset-key="item.id"
              :data-charset-title="translateExternal(item.name)"
              :data-tooltip="`${translateExternal(item.name)}\n${item.codePointCount}/${item.total}`"
            >
              <span class="unicode-block-name">{{ translateExternal(item.name) }}</span>
              <span class="unicode-block-count">{{ item.codePointCount }}/{{ item.total }}</span>
            </article>
          </div>
        </section>
      </div>
    </template>
  </section>

  <section v-else-if="activeDetailTab === 'notes'" class="detail-panel detail-panel--notes">
    <p v-if="detailLoading && !selectedDetail" class="muted">{{ t('ui.loadingNotes') }}</p>
    <template v-else-if="selectedDetail">
      <label class="note-label">{{ t('ui.language') }}</label>
      <div class="note-language">
        <CustomSelect
          class="note-language-select"
          :model-value="languageSelectValue"
          :options="languageOptions"
          :ariaLabel="t('ui.fontLanguage')"
          @update:model-value="onLanguageChange"
        />
        <span v-if="isLanguageManual && selectedDetail.inferredLanguage" class="note-language-hint">
          {{ t('ui.setManually') }} ·
          <button
            type="button"
            class="note-language-restore"
            :data-tooltip="t('ui.restoreAutomatic')"
            @click="restoreInferredLanguage"
          >{{ t('ui.automaticallyInferredAs') }}{{ translateExternal(selectedDetail.inferredLanguage) }}</button>
        </span>
        <span v-else-if="isLanguageManual" class="note-language-hint">{{ t('ui.setManually') }}</span>
        <span v-else-if="selectedDetail.inferredLanguage" class="note-language-hint">{{ t('ui.automaticallyInferred') }}</span>
        <span v-else class="note-language-hint">{{ t('ui.couldNotInferAutomatically') }}</span>
      </div>

      <label class="note-label">{{ t('ui.tags') }}</label>
      <div class="note-tags" data-note-tags>
        <TransitionGroup name="note-tag">
          <span v-for="tag in detailTags" :key="tag" class="note-tag">
            {{ tag }}
            <button type="button" class="note-tag-remove" :aria-label="`${t('ui.removeTag')} ${tag}`" @mousedown.prevent @click="removeTag(tag)">×</button>
          </span>
        </TransitionGroup>
        <div class="note-tag-input-wrap">
        <AppInput
            id="font-tags"
            ref="tagInputRef"
            v-model="tagDraft"
            class="note-tag-input"
            variant="plain"
            :maxlength="TAG_NAME_MAX"
            :disabled="detailTags.length >= FAMILY_TAGS_MAX"
            :placeholder="tagPlaceholder"
            autocomplete="off"
            :aria-label="t('ui.fontTags')"
            @focus="tagInputFocused = true"
            @blur="onTagBlur"
            @keydown="onTagKeydown"
          />
          <Transition name="note-suggest">
            <div v-if="showTagSuggestions" class="note-tag-suggestions fancy-scroll" role="listbox">
              <div ref="tagSuggestionsRef" class="note-tag-suggestions-scroll fancy-scroll__viewport">
                <button
                  v-for="tag in tagSuggestions"
                  :key="tag"
                  type="button"
                  class="note-tag-suggestion"
                  role="option"
                  @mousedown.prevent="addTag(tag)"
                >
                  {{ tag }}
                </button>
                <button
                  v-if="canCreateTag"
                  type="button"
                  class="note-tag-suggestion note-tag-suggestion--create"
                  role="option"
                  @mousedown.prevent="addTag(tagDraft)"
                >
                  {{ t('ui.create') }} 「{{ normalizeTagName(tagDraft) }}」
                </button>
              </div>
              <FancyScrollbar :target="tagSuggestionsRef" :aria-label="t('ui.tagSuggestionsScrollbar')" />
            </div>
          </Transition>
        </div>
      </div>
      <div class="note-common-tags" data-note-tags>
        <div class="note-common-tags-head">
          <span class="note-common-tags-label">{{ t('ui.commonTags') }}</span>
          <button type="button" class="note-common-tags-edit" @click="emit('open-tag-settings')">{{ t('ui.commonEdit') }}</button>
        </div>
        <div v-if="commonTagItems.length" class="note-common-tags-list">
          <button
            v-for="item in commonTagItems"
            :key="item.name"
            type="button"
            class="note-common-tag"
            :class="{ 'is-active': item.active }"
            :disabled="!item.active && detailTags.length >= FAMILY_TAGS_MAX"
            @click="toggleCommonTag(item.name)"
          >
            {{ item.name }}
          </button>
        </div>
        <p v-else class="note-common-tags-empty">{{ t('ui.noCommonTagsAddThemInSettings') }}</p>
      </div>
      <p class="note-tag-hint">{{ detailTags.length }}/{{ FAMILY_TAGS_MAX }} · {{ t('ui.tagsApplyToTheEntireFontFamily') }} · {{ t('ui.rightClickTagsToConfigure') }}</p>

      <label class="note-label" for="font-note">{{ t('ui.fontNote') }}</label>
      <AppInput
        id="font-note"
        v-model="detailNote"
        class="note-textarea"
        multiline
        :rows="3"
        multiline-height="100px"
        :maxlength="2000"
        :placeholder="t('ui.recordUsageLicenseInformationOrGuidance')"
        :aria-label="t('ui.fontNote')"
        @blur="onNoteBlur"
      />
      <div class="note-actions">
        <span>{{ detailNote.length }}/2000</span>
        <span class="note-save-status" :class="`note-save-status--${noteSaveStatus}`">
          {{ noteSaveStatus === 'saving' ? t('ui.saving') : noteSaveStatus === 'saved' ? t('ui.saved') : t('ui.autosaved') }}
        </span>
      </div>

      <label class="note-label">{{ t('ui.linkedFonts') }}</label>
      <p v-if="linkedError" class="error">{{ linkedError }}</p>
      <div class="detail-family-card-list" :class="`detail-family-card-list--${viewMode}`" :style="detailCardGridStyle">
        <TransitionGroup name="linked-card" tag="div" class="detail-family-card-transition" @before-leave="captureCardLeaveWidth">
          <FontFamilyPreviewCard
            v-for="face in displayedLinkedFonts"
            :key="face.id"
            :face="face"
            :family-name-mode="familyNameMode"
            :preview-text="previewText"
            :rendered-text="linkedRenderedText.get(face.id)"
            :preview-font-family="linkedPreviewFonts.get(face.id)"
            :preview-unavailable="linkedPreviewErrors.has(face.id)"
            :preview-font-size="previewFontSize"
            :view-mode="viewMode"
            removable
            @open="emit('open-family', $event)"
            @remove="removeLink"
          />
        </TransitionGroup>
      </div>
      <p v-if="!linkedLoading && !linkedFonts.length" class="muted note-links-empty">{{ t('ui.noLinkedFontsHint') }}</p>
      <p v-if="linkedFonts.length" class="muted note-links-hint">{{ t('ui.linkedFontHint') }}</p>
      <div class="note-link-actions">
        <button type="button" class="note-link-add" :disabled="linkedLoading || linkedClearing" @click="openLinkPicker">{{ t('ui.addLinkedFont') }}</button>
        <button v-if="linkedFonts.length" type="button" class="note-link-clear" :disabled="linkedClearing" @click="clearLinksConfirmOpen = true">{{ t('ui.clearLinkedFonts') }}</button>
      </div>
      <Transition name="link-picker" @after-enter="scrollLinkPickerIntoView">
      <div v-if="linkPickerOpen" ref="linkPickerRef" class="note-link-picker">
        <div class="note-link-picker-head">
          <AppInput
            ref="linkSearchInputRef"
            v-model="linkQuery"
            class="link-picker-search"
            type="search"
            :placeholder="t('ui.searchLinkedFont')"
            :aria-label="t('ui.searchLinkedFont')"
            autocomplete="off"
            @keydown.escape="closeLinkPicker"
          >
            <template #trailing>
              <button
                v-if="linkQuery"
                type="button"
                class="link-picker-search-clear"
                :aria-label="t('ui.commonClear')"
                :data-tooltip="t('ui.commonClear')"
                @mousedown.prevent
                @click="linkQuery = ''"
              >×</button>
            </template>
          </AppInput>
          <button type="button" class="note-link-picker-close" :aria-label="t('ui.commonClose')" @click="closeLinkPicker">×</button>
        </div>
        <div class="note-link-picker-results fancy-scroll">
          <div ref="linkResultsRef" class="note-link-picker-results-scroll fancy-scroll__viewport">
            <p v-if="linkSearching && !linkResults.length" class="muted">{{ t('ui.commonLoading') }}</p>
            <p v-else-if="!linkResults.length" class="muted">{{ t('ui.noSearchResultsForLinks') }}</p>
            <TransitionGroup name="link-search-card" tag="div" class="link-search-card-list" @before-leave="captureCardLeaveWidth">
              <FontFamilyPreviewCard
                v-for="face in linkResults"
                :key="face.id"
                :face="face"
                :family-name-mode="familyNameMode"
                :preview-text="previewText"
                :rendered-text="linkedRenderedText.get(face.id)"
                :preview-font-family="linkedPreviewFonts.get(face.id)"
                :preview-unavailable="linkedPreviewErrors.has(face.id)"
                :preview-font-size="previewFontSize"
                :view-mode="viewMode"
                @open="addLink(face)"
              />
            </TransitionGroup>
          </div>
          <FancyScrollbar :target="linkResultsRef" :aria-label="t('ui.searchLinkedFont')" />
        </div>
        <div class="charset-pagination">
          <button type="button" class="charset-page-btn" :disabled="linkSearching || linkSearchPage <= 1" @click="goLinkSearchPage(-1)">{{ t('ui.previous') }}</button>
          <span class="charset-page-label">{{ linkSearchPage }}</span>
          <button type="button" class="charset-page-btn" :disabled="linkSearching || !linkSearchNextCursor" @click="goLinkSearchPage(1)">{{ t('ui.next') }}</button>
        </div>
      </div>
      </Transition>
    </template>
  </section>
      </div>
      </Transition>
      </div>
      <FancyScrollbar :target="detailScrollRef" :aria-label="t('ui.detailsScrollbar')" />
    </div>
  </div>

  <CharsetViewerModal
    ref="charsetModalRef"
    :selected-detail="selectedDetail"
    @error="emit('error', $event)"
  />

  <AppConfirmDialog
    v-model:open="clearLinksConfirmOpen"
    :title="t('ui.clearLinkedFonts')"
    :message="t('ui.clearLinkedFontsConfirm')"
    :confirm-label="t('ui.commonClear')"
    :cancel-label="t('ui.commonCancel')"
    @confirm="clearLinks"
  />

</template>

<style scoped>
.muted {
  color: var(--ink-5);
}

.error {
  color: var(--danger-ink);
}

.detail-root {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.detail-navigation {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  margin: 0;
  padding: 2px 0 12px;
  background: var(--bg);
}

.detail-scroll-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}

.detail-scroll {
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 6px 14px 28px;
  scrollbar-width: none;
}

.detail-scroll::-webkit-scrollbar {
  display: none;
}

.detail-tab-pane {
  min-width: 0;
}

.detail-tab-next-enter-active,
.detail-tab-next-leave-active,
.detail-tab-prev-enter-active,
.detail-tab-prev-leave-active {
  transition: opacity .12s ease, transform .12s ease;
  will-change: opacity, transform;
}

.detail-tab-next-enter-from {
  opacity: 0;
  transform: translateX(10px);
}

.detail-tab-next-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

.detail-tab-prev-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}

.detail-tab-prev-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

.detail-tabs {
  position: relative;
  display: flex;
  gap: 4px;
  min-width: 0;
  margin: 0;
  border-bottom: 1px solid var(--line);
}

.detail-tabs button {
  margin: 0;
  padding: 9px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--detail-muted);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: color .18s ease;
}

.detail-tabs button:hover,
.detail-tabs button.active {
  color: var(--accent-ink);
}

.detail-tabs-indicator {
  position: absolute;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
  pointer-events: none;
}

.detail-tabs--ready .detail-tabs-indicator {
  transition: transform .22s ease, width .22s ease;
}

.detail-variant {
  display: flex;
  flex: none;
  align-items: center;
  margin-left: auto;
}

.detail-variant :deep(.custom-select) {
  min-width: 180px;
}

.detail-panel {
  max-width: 920px;
  padding: 2px 0 18px;
}

.detail-panel--parameters,
.detail-panel--charset,
.detail-panel--similar,
.detail-panel--notes {
  max-width: none;
}

.similar-intro {
  margin: 0 0 14px;
  color: var(--detail-muted);
  font-size: 13px;
  line-height: 1.65;
}

.detail-family-card-list {
  position: relative;
  display: grid;
  gap: 10px;
}

.detail-family-card-list--list {
  grid-template-columns: minmax(0, 1fr);
}

.detail-family-card-transition { display: contents; }

.linked-card-enter-active,
.linked-card-leave-active,
.linked-card-move,
.link-search-card-enter-active,
.link-search-card-leave-active,
.link-search-card-move {
  transition: opacity .2s ease, transform .2s ease;
}

.linked-card-enter-from,
.linked-card-leave-to,
.link-search-card-enter-from,
.link-search-card-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.linked-card-leave-active,
.link-search-card-leave-active {
  position: absolute;
  top: var(--card-leave-top);
  left: var(--card-leave-left);
  width: var(--card-leave-width, auto);
  height: var(--card-leave-height, auto);
}

.charset-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 12px;
}

.charset-summary {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--detail-soft);
  font-size: 13px;
}

.note-language {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 0 0 16px;
}

.note-language-select {
  min-width: 140px;
}

.note-language-hint {
  display: inline;
  color: var(--ink-5);
  font-size: 11px;
  line-height: 1.4;
}

.note-language-restore {
  display: inline;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: inherit;
  vertical-align: baseline;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
  cursor: pointer;
  transition: color var(--ease), text-decoration-color var(--ease);
}

.note-language-restore:hover,
.note-language-restore:focus-visible {
  color: var(--link-accent);
  text-decoration-color: currentColor;
  outline: 0;
}

.charset-view-switch {
  flex: none;
  height: 32px;
}

.charset-view-switch :deep(.segmented-control__option span) {
  padding: 0 12px;
  font-size: 12px;
}

.unicode-blocks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 8px;
}

.unicode-blocks article {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-white);
  cursor: context-menu;
}

.charset-pagination {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}

.charset-page-btn {
  margin: 0;
  padding: 6px 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--bg-white);
  color: var(--ink-2);
  font-family: inherit;
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
}

.charset-page-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-ink);
}

.charset-page-btn:disabled {
  opacity: .4;
  cursor: default;
}

.charset-page-label {
  min-width: 64px;
  color: var(--ink-4);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.unicode-block-name {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unicode-block-count {
  color: var(--ink-5);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cjk-coverage {
  display: grid;
  gap: 18px;
}

.cjk-coverage-title {
  margin: 0 0 8px;
  color: var(--ink-3);
  font-size: 13px;
  font-weight: 700;
}

.note-label {
  display: block;
  margin-bottom: 7px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.note-tags {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  background-color: var(--bg-white);
  transition: border-color var(--ease), box-shadow var(--ease);
}

.note-tags:hover,
.note-tags:focus-within {
  border-color: var(--accent);
}

.note-tags:focus-within {
  box-shadow: var(--focus-ring);
}

.note-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 4px 8px 4px 10px;
  border-radius: 999px;
  background: var(--tag-bg);
  color: var(--tag-ink);
  font-size: 12px;
  font-weight: 600;
}

.note-tag-remove {
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

.note-tag-remove:hover {
  background: var(--tag-remove-bg);
  color: var(--tag-remove-ink);
}

.note-tag-input-wrap {
  position: relative;
  flex: 1 1 140px;
  min-width: 120px;
}

.note-tag-input {
  width: 100%;
  min-height: 28px;
  padding: 4px 2px;
}

.note-tag-suggestions {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 8;
  min-width: min(240px, 70vw);
  max-height: 220px;
  border: 1px solid var(--line-2);
  border-radius: 10px;
  background: var(--bg-white);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.note-tag-suggestions-scroll {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  padding: 6px;
}

.note-tag-suggestion {
  display: block;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--chip-ink);
  font: 13px var(--ui-font);
  text-align: left;
  cursor: pointer;
}

.note-tag-suggestion:hover,
.note-tag-suggestion:focus-visible {
  background: var(--chip-bg);
  outline: none;
}

.note-tag-suggestion--create {
  color: var(--accent-ink);
  font-weight: 600;
}

.note-tag-enter-active,
.note-tag-leave-active {
  transition: opacity .2s ease, transform .2s ease;
}

.note-tag-enter-from {
  opacity: 0;
  transform: scale(.7);
}

.note-tag-leave-to {
  opacity: 0;
  transform: scale(.7);
}

.note-tag-leave-active {
  position: absolute;
}

.note-tag-move {
  transition: transform .2s ease;
}

.note-suggest-enter-active,
.note-suggest-leave-active {
  transition: opacity var(--ease), transform var(--ease);
}

.note-suggest-enter-from,
.note-suggest-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(.97);
}

.note-tag-input :deep(input.note-tag-placeholder-pulse::placeholder) {
  animation: note-tag-placeholder-fade .2s ease;
}

@keyframes note-tag-placeholder-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.note-common-tags {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  background: var(--bg-soft);
}

.note-common-tags-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.note-common-tags-label {
  color: var(--ink-4);
  font-size: 12px;
  font-weight: 400;
}

.note-common-tags-edit {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--link-accent);
  font-family: inherit;
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
}

.note-common-tags-edit:hover {
  text-decoration: underline;
}

.note-common-tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.note-common-tag {
  margin: 0;
  padding: 4px 10px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  background: var(--bg-white);
  color: var(--ink-3);
  font-family: inherit;
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  transition: border-color var(--ease), background var(--ease), color var(--ease);
}

.note-common-tag:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-ink);
}

.note-common-tag.is-active {
  border-color: transparent;
  background: var(--tag-bg);
  color: var(--tag-ink);
}

.note-common-tag:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.note-common-tags-empty {
  margin: 0;
  color: var(--ink-5);
  font-size: 12px;
}

.note-tag-hint {
  margin: 8px 0 16px;
  color: var(--ink-5);
  font-size: 11px;
}

.note-textarea {
  width: 100%;
  border-radius: var(--radius);
}

.note-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  color: var(--ink-5);
  font-size: 11px;
}

.note-actions + .note-label {
  margin-top: 16px;
}

.note-save-status {
  color: var(--ink-5);
  transition: color .15s;
}

.note-save-status--saved {
  color: var(--link-accent);
}

.note-links-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.note-link {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-white);
}

.note-link:hover {
  border-color: var(--accent);
}

.note-link-preview {
  display: block;
  width: 100%;
  margin: 0;
  padding: 4px 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: 24px;
  line-height: 1.3;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.note-link-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.note-link-name {
  overflow: hidden;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  font: inherit;
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.note-link-name:hover {
  color: var(--accent);
}

.note-link-remove {
  flex: none;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-5);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.note-link-remove:hover {
  background: var(--search-clear-bg);
  color: var(--ink-2);
}

.note-links-empty {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

.note-links-hint {
  margin: 8px 0 0;
  font-size: 11px;
}

.note-link-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.note-link-add,
.note-link-clear {
  padding: 8px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-3);
  font-size: 12px;
  cursor: pointer;
  transition: border-color var(--ease), color var(--ease);
}

.note-link-add:hover:not(:disabled),
.note-link-clear:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.note-link-add:disabled,
.note-link-clear:disabled {
  opacity: .55;
  cursor: default;
}

.note-link-clear {
  border-style: solid;
  color: var(--danger-ink);
}

.note-link-picker {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-soft);
}

.link-picker-enter-active,
.link-picker-leave-active {
  overflow: hidden;
  transition: max-height .22s ease, margin-top .22s ease, opacity .16s ease;
}

.link-picker-enter-from,
.link-picker-leave-to {
  max-height: 0;
  margin-top: 0;
  opacity: 0;
}

.link-picker-enter-to,
.link-picker-leave-from {
  max-height: 520px;
  opacity: 1;
}

.note-link-picker-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.note-link-picker-head .link-picker-search {
  flex: 1;
  min-width: 0;
  margin: 0;
}

.link-picker-search-clear {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--search-clear-bg);
  color: var(--search-clear);
  font: 16px/1 var(--ui-font);
  cursor: pointer;
}

.link-picker-search-clear:hover {
  color: var(--ink-2);
}

.note-link-picker-close {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-4);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.note-link-picker-close:hover {
  background: var(--search-clear-bg);
  color: var(--ink-2);
}

.note-link-picker-results {
  position: relative;
  min-height: 100px;
  max-height: 280px;
  margin-top: 10px;
}

.note-link-picker-results-scroll {
  display: grid;
  gap: 8px;
  max-height: 280px;
  padding-right: 8px;
}

.link-search-card-list {
  position: relative;
  display: grid;
  gap: 8px;
}

.note-link-picker-results-scroll > .muted {
  margin: 8px 0;
  font-size: 12px;
}

.link-picker-backdrop {
  position: fixed;
  z-index: 1200;
  inset: 42px 0 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--overlay);
}

.link-picker {
  display: flex;
  flex-direction: column;
  width: min(520px, 100%);
  max-height: min(72vh, 640px);
  padding: 20px;
  border: 1px solid var(--modal-border);
  border-radius: 14px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-xl);
}

.link-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.link-picker-head h2 {
  margin: 0;
  font-size: 16px;
}

.link-picker-close {
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-4);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.link-picker-close:hover {
  background: var(--search-clear-bg);
  color: var(--ink-2);
}

.link-picker-search {
  margin-bottom: 12px;
}

.link-picker-results {
  flex: 1;
  min-height: 160px;
  max-height: 52vh;
}

.link-picker-results-scroll {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 4px;
}

.link-picker-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-white);
  color: var(--ink-2);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--ease);
}

.link-picker-item:hover {
  border-color: var(--accent);
}

.link-picker-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-picker-item-sub {
  flex: none;
  color: var(--ink-5);
  font-size: 12px;
}

@media (max-width: 620px) {
  .detail-navigation {
    gap: 8px;
  }

  .detail-tabs {
    overflow-x: auto;
  }

  .detail-tabs button {
    flex: none;
  }

  .detail-variant :deep(.custom-select) {
    min-width: 112px;
  }
}
</style>
