import { computed, ref, watch, type Ref, type ComputedRef } from 'vue'
import type { FontFaceDetail, FontFaceSummary, FontLanguage } from '@fontral/contracts'
import type { CopyNameLanguage, CopyNameType, FamilyNameMode } from './useSettings'
import { useI18n } from './useI18n'

export function fileSize(value: number) {
  return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function displayFamily(face: Pick<FontFaceSummary, 'family' | 'preferredFamily'>, mode: FamilyNameMode) {
  if (mode === 'preferred' && face.preferredFamily) return face.preferredFamily
  return face.family
}

export function displaySubfamily(face: Pick<FontFaceSummary, 'subfamily' | 'preferredSubfamily'>, mode: FamilyNameMode) {
  if (mode === 'preferred' && face.preferredSubfamily) return face.preferredSubfamily
  return face.subfamily || 'Regular'
}

function normalizeLanguage(language: string) {
  return language.trim().toLowerCase().replace(/_/g, '-')
}

function isEnglishLanguage(language: string) {
  const normalized = normalizeLanguage(language)
  return normalized === 'en' || normalized.startsWith('en-') || normalized === '0x409' || normalized === '1033'
}

function systemLocales() {
  const locales = typeof navigator !== 'undefined'
    ? [...(navigator.languages ?? []), navigator.language].filter(Boolean)
    : []
  const tags = new Set<string>()
  for (const locale of locales) {
    const normalized = normalizeLanguage(locale)
    if (!normalized) continue
    tags.add(normalized)
    const base = normalized.split('-')[0]
    if (base) tags.add(base)
  }
  return [...tags]
}

function languageMatchScore(language: string, preferred: string[]) {
  const normalized = normalizeLanguage(language)
  if (!normalized) return -1
  const base = normalized.split('-')[0] ?? normalized
  for (let index = 0; index < preferred.length; index += 1) {
    const tag = preferred[index]
    if (normalized === tag || base === tag || normalized.startsWith(`${tag}-`) || tag.startsWith(`${normalized}-`)) {
      return preferred.length - index
    }
  }
  return -1
}

function pickLocalizedName(
  detail: FontFaceDetail | null | undefined,
  type: string,
  preference: 'english' | 'locale',
) {
  const names = detail?.localizedNames.filter(item => item.type === type && item.value.trim()) ?? []
  if (!names.length) return null

  if (preference === 'english') {
    return names.find(item => isEnglishLanguage(item.language))?.value
      ?? names[0]?.value
      ?? null
  }

  const preferred = systemLocales()
  let best: { value: string; score: number } | null = null
  let fallbackNonEnglish: string | null = null

  for (const item of names) {
    const score = languageMatchScore(item.language, preferred)
    if (score >= 0 && (!best || score > best.score)) best = { value: item.value, score }
    if (!fallbackNonEnglish && !isEnglishLanguage(item.language)) fallbackNonEnglish = item.value
  }

  return best?.value ?? fallbackNonEnglish ?? names[0]?.value ?? null
}

export function resolveCopyName(
  face: Pick<FontFaceSummary, 'family' | 'preferredFamily' | 'fullName' | 'postscriptName' | 'subfamily'>,
  type: CopyNameType,
  language: CopyNameLanguage,
  detail?: FontFaceDetail | null,
) {
  if (type === 'family') return face.family
  if (type === 'preferredFamily') return face.preferredFamily || face.family
  if (type === 'postscript') return face.postscriptName || face.fullName || face.family

  const fallback = face.fullName
    || [face.family, face.subfamily].filter(Boolean).join(' ')
    || face.family

  return pickLocalizedName(detail, 'localizedNameType.fullName', language) || fallback
}

export function compareFacesByWeight(a: FontFaceSummary, b: FontFaceSummary) {
  const weight = (a.weight ?? 400) - (b.weight ?? 400)
  if (weight) return weight
  return a.id - b.id
}

export function sortFacesByWeight(faces: FontFaceSummary[]) {
  return [...faces].sort(compareFacesByWeight)
}

export type LibraryView = 'all' | 'favorites' | 'active' | 'inactive'

/** Batch size for cursor pages in the home list. */
const QUERY_BATCH = 200
/** Fetch another page before the current virtual window reaches loaded data's end. */
export const QUERY_PREFETCH_AHEAD = 100
const FILTER_REFRESH_DELAY = 150

export type WeightFilter = { start: number; end: number } | null
export type ItalicFilter = '' | 'normal' | 'italic'
export type VariableFilter = '' | 'yes' | 'no'
export type LanguageFilter = FontLanguage[]
export type FormatFilter = 'ttf' | 'otf' | 'ttc' | 'otc' | 'woff' | 'woff2'

export function useFonts(
  api: typeof window.fontral,
  filters: {
    text: Ref<string>
    libraryView: Ref<LibraryView>
    activeFaceIds: Ref<Set<number>>
    weight: Ref<WeightFilter>
    italic: Ref<ItalicFilter>
    variable: Ref<VariableFilter>
    languages: Ref<LanguageFilter>
    tags: Ref<string[]>
    formats: Ref<FormatFilter[]>
    glyphCountMin: Ref<number | null>
    glyphCountMax: Ref<number | null>
    groupByFamily: Ref<boolean>
    rootId: Ref<number | undefined> | ComputedRef<number | undefined>
    pathPrefix: Ref<string | undefined> | ComputedRef<string | undefined>
  },
  onError: (message: string) => void,
  onFacesLoaded?: (faces: FontFaceSummary[], meta?: { replace?: boolean }) => void,
) {
  const { t } = useI18n()
  const faces = ref<FontFaceSummary[]>([])
  const selectedFamily = ref<string | null>(null)
  const familyFaces = ref<FontFaceSummary[]>([])
  const familyLoading = ref(false)
  const activeDetailTab = ref<'preview' | 'similar' | 'properties' | 'charset' | 'notes'>('preview')
  const detailTabs = computed<Array<{ id: typeof activeDetailTab.value; label: string }>>(() => [
    { id: 'preview', label: t('ui.preview') },
    { id: 'properties', label: t('ui.properties') },
    { id: 'charset', label: t('ui.characterSet') },
    { id: 'notes', label: t('ui.notes') },
    { id: 'similar', label: t('ui.similarFonts') },
  ])
  const selectedDetail = ref<FontFaceDetail | null>(null)
  const selectedDetailFaceId = ref<number | null>(null)
  const detailLoading = ref(false)
  const detailNote = ref('')
  const detailTags = ref<string[]>([])
  const detailLanguage = ref<FontLanguage | null>(null)
  const availableTags = ref<string[]>([])
  const noteSaveStatus = ref<'idle' | 'saving' | 'saved'>('idle')
  let savedNote = ''
  let savedTagsKey = ''
  let savedLanguage: FontLanguage | null = null
  let saveNotePromise: Promise<void> | null = null
  let noteSavingTimer: number | undefined
  let noteSavedTimer: number | undefined
  const copiedName = ref<string | null>(null)
  const copiedFamily = ref<number | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const nextCursor = ref<number | undefined>(undefined)
  const hasMore = ref(false)
  const totalFaces = ref(0)
  let refreshSeq = 0
  let loadMorePromise: Promise<void> | null = null
  const displayedFaces = computed(() => (selectedFamily.value ? familyFaces.value : faces.value))

  function folderFilter() {
    const rootId = filters.rootId.value
    const pathPrefix = filters.pathPrefix.value
    if (!rootId && !pathPrefix) return undefined
    return { rootId, pathPrefix }
  }

  function queryInput(cursor?: number, options?: { includeTotal?: boolean; limit?: number }) {
    const view = filters.libraryView.value
    const activeIds = [...filters.activeFaceIds.value]
    const glyphStart = filters.glyphCountMin.value ?? 0
    const glyphEnd = filters.glyphCountMax.value ?? 65_535
    const glyphCountMin = Math.min(glyphStart, glyphEnd)
    const glyphCountMax = Math.max(glyphStart, glyphEnd)
    return {
      text: filters.text.value,
      favorite: view === 'favorites' ? true : undefined,
      faceIds: view === 'active' ? activeIds : undefined,
      excludeFaceIds: view === 'inactive' && activeIds.length ? activeIds : undefined,
      weightMin: filters.weight.value ? Math.min(filters.weight.value.start, filters.weight.value.end) : undefined,
      weightMax: filters.weight.value ? Math.max(filters.weight.value.start, filters.weight.value.end) : undefined,
      italic: filters.italic.value === '' ? undefined : filters.italic.value === 'italic',
      variable: filters.variable.value === '' ? undefined : filters.variable.value === 'yes',
      languages: filters.languages.value.length ? [...filters.languages.value] : undefined,
      tags: filters.tags.value.length ? [...filters.tags.value] : undefined,
      formats: filters.formats.value.length ? [...filters.formats.value] : undefined,
      glyphCountMin: (filters.glyphCountMin.value !== null || filters.glyphCountMax.value !== null) && Number.isFinite(glyphCountMin) ? glyphCountMin : undefined,
      glyphCountMax: (filters.glyphCountMin.value !== null || filters.glyphCountMax.value !== null) && Number.isFinite(glyphCountMax) ? glyphCountMax : undefined,
      groupByFamily: filters.groupByFamily.value,
      limit: options?.limit ?? QUERY_BATCH,
      rootId: filters.rootId.value,
      pathPrefix: filters.pathPrefix.value,
      cursor,
      includeTotal: options?.includeTotal,
    }
  }

  function linkedDisplayQuery(linkedIds: number[], cursor?: number, options?: { includeTotal?: boolean; limit?: number }) {
    const q = queryInput(cursor, options)
    const view = filters.libraryView.value
    if (view === 'active') {
      const activeSet = new Set(filters.activeFaceIds.value)
      q.faceIds = linkedIds.filter(id => activeSet.has(id))
    } else {
      q.faceIds = linkedIds
    }
    return q
  }

  async function loadMore(seq = refreshSeq) {
    if (selectedFamily.value || loadingMore.value || !hasMore.value) return
    const cursor = nextCursor.value
    if (cursor === undefined) return
    if (loadMorePromise) return loadMorePromise

    loadingMore.value = true
    loadMorePromise = (async () => {
      try {
        const page = await api.fonts.query(queryInput(cursor, { includeTotal: false }))
        if (seq !== refreshSeq) return
        if (page.total !== undefined) totalFaces.value = page.total
        if (!page.items.length) {
          nextCursor.value = undefined
          hasMore.value = false
          return
        }
        const seen = new Set(faces.value.map(face => face.id))
        const appended = page.items.filter(face => !seen.has(face.id))
        if (appended.length) faces.value = faces.value.concat(appended)
        nextCursor.value = page.nextCursor
        hasMore.value = page.nextCursor !== undefined
        onFacesLoaded?.(appended.length ? appended : page.items, { replace: false })
      } catch (cause) {
        if (seq !== refreshSeq) return
        onError(cause instanceof Error ? cause.message : t('ui.couldNotLoadMoreFonts'))
      } finally {
        if (seq === refreshSeq) loadingMore.value = false
        loadMorePromise = null
      }
    })()
    return loadMorePromise
  }

  async function hydrateAll(seq: number) {
    while (seq === refreshSeq && hasMore.value && !selectedFamily.value) {
      await loadMore(seq)
    }
  }

  async function refresh(options?: { soft?: boolean }) {
    const seq = ++refreshSeq
    // Soft refresh (scan streaming): keep cards; only fetch faces newer than the highest known id.
    const soft = Boolean(options?.soft)
    if (!soft) loading.value = true
    loadingMore.value = false
    loadMorePromise = null
    if (!soft) {
      nextCursor.value = undefined
      hasMore.value = false
      totalFaces.value = 0
    }
    try {
      if (soft) {
        const maxId = faces.value.reduce((max, face) => (face.id > max ? face.id : max), 0)
        // Empty list: same as a normal first page so the first batch paints immediately.
        const page = await api.fonts.query(queryInput(maxId || undefined, { includeTotal: false }))
        if (seq !== refreshSeq) return
        if (!page.items.length) return
        if (!faces.value.length) {
          faces.value = page.items
          if (page.total !== undefined) totalFaces.value = page.total
          nextCursor.value = page.nextCursor
          hasMore.value = page.nextCursor !== undefined
          onFacesLoaded?.(page.items, { replace: false })
          // Keep pulling while scanning so the home list fills without a hard refresh.
          await hydrateAll(seq)
          if (seq !== refreshSeq) return
          onFacesLoaded?.(faces.value, { replace: true })
          return
        }
        const seen = new Set(faces.value.map(face => face.id))
        const appended = page.items.filter(face => !seen.has(face.id))
        if (!appended.length) return
        faces.value = faces.value.concat(appended)
        if (page.total !== undefined) totalFaces.value = page.total
        nextCursor.value = page.nextCursor
        hasMore.value = page.nextCursor !== undefined
        onFacesLoaded?.(appended, { replace: false })
        // Drain any further pages that arrived since the last soft tick.
        await hydrateAll(seq)
        if (seq !== refreshSeq) return
        onFacesLoaded?.(faces.value, { replace: false })
        return
      }

      const searchText = filters.text.value.trim()
      const page = await api.fonts.query(queryInput(undefined, { includeTotal: !searchText }))
      if (seq !== refreshSeq) return
      faces.value = page.items
      totalFaces.value = page.total ?? page.items.length
      nextCursor.value = page.nextCursor
      hasMore.value = page.nextCursor !== undefined
      // Filtering should return control after the first page; later pages load near the scroll edge.
      onFacesLoaded?.(page.items, { replace: true })
      loading.value = false
    } catch (cause) {
      if (seq !== refreshSeq) return
      onError(cause instanceof Error ? cause.message : t('ui.couldNotQueryFonts'))
      if (seq === refreshSeq && !soft) loading.value = false
    }
  }

  async function openFamily(family: string) {
    selectedFamily.value = family
    activeDetailTab.value = 'preview'
    selectedDetail.value = null
    familyLoading.value = true
    try {
      familyFaces.value = sortFacesByWeight(await api.fonts.family(family, folderFilter()))
      onFacesLoaded?.(familyFaces.value, { replace: false })
      selectedDetailFaceId.value = familyFaces.value[0]?.id ?? null
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('ui.couldNotReadFontFamily'))
    } finally {
      familyLoading.value = false
    }
  }

  async function refreshFamilyFaces(family: string) {
    if (!family) return
    try {
      const refreshed = sortFacesByWeight(await api.fonts.family(family, folderFilter()))
      const currentId = selectedDetailFaceId.value
      familyFaces.value = refreshed
      onFacesLoaded?.(refreshed, { replace: false })
      if (currentId && !refreshed.some(face => face.id === currentId)) {
        selectedDetailFaceId.value = refreshed[0]?.id ?? null
      } else if (!currentId) {
        selectedDetailFaceId.value = refreshed[0]?.id ?? null
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('ui.couldNotReadFontFamily'))
    }
  }

  async function closeFamily() {
    if (selectedDetail.value && isNoteDirty()) await saveDetailNote()
    selectedFamily.value = null
    familyFaces.value = []
    selectedDetail.value = null
    selectedDetailFaceId.value = null
    detailTags.value = []
    detailLanguage.value = null
    rememberSavedNote('', [], null)
  }

  async function refreshAvailableTags() {
    try {
      availableTags.value = await api.fonts.listTags()
    } catch {
      availableTags.value = []
    }
  }

  function tagsKey(tags: string[]) {
    return tags.map(tag => tag.toLowerCase()).join('\0')
  }

  function isNoteDirty() {
    return detailNote.value !== savedNote || tagsKey(detailTags.value) !== savedTagsKey
  }

  function rememberSavedNote(note: string, tags: string[], language: FontLanguage | null = savedLanguage) {
    savedNote = note
    savedTagsKey = tagsKey(tags)
    savedLanguage = language
  }

  async function loadDetail(faceId: number) {
    if (selectedDetail.value && isNoteDirty()) await saveDetailNote()
    if (!selectedDetail.value) detailLoading.value = true
    try {
      const [detail] = await Promise.all([api.fonts.details(faceId), refreshAvailableTags()])
      if (selectedDetailFaceId.value !== faceId) return
      const previousFamily = selectedDetail.value && (selectedDetail.value.preferredFamily || selectedDetail.value.family)
      const detailFamily = detail && (detail.preferredFamily || detail.family)
      const keepFamilyMetadata = Boolean(previousFamily && detailFamily === previousFamily)
      selectedDetail.value = detail
      if (keepFamilyMetadata) return
      const note = detail?.note ?? ''
      const tags = detail?.tags ?? []
      const language = detail?.language ?? null
      detailNote.value = note
      detailTags.value = tags
      detailLanguage.value = language
      rememberSavedNote(note, tags, language)
    } catch (cause) {
      if (selectedDetailFaceId.value !== faceId) return
      onError(cause instanceof Error ? cause.message : t('ui.couldNotReadFontDetails'))
    } finally {
      if (selectedDetailFaceId.value === faceId) detailLoading.value = false
    }
  }

  function clearNoteStatusTimers() {
    window.clearTimeout(noteSavingTimer)
    window.clearTimeout(noteSavedTimer)
    noteSavingTimer = undefined
    noteSavedTimer = undefined
  }

  async function saveDetailNote() {
    if (!selectedDetail.value || !isNoteDirty()) return
    if (saveNotePromise) {
      await saveNotePromise
      if (!isNoteDirty()) return
    }
    const faceId = selectedDetail.value.id
    const note = String(detailNote.value ?? '')
    const tags = detailTags.value.map(tag => String(tag))
    clearNoteStatusTimers()
    noteSavingTimer = window.setTimeout(() => {
      if (saveNotePromise) noteSaveStatus.value = 'saving'
    }, 150)
    saveNotePromise = (async () => {
      try {
        await Promise.all([
          api.fonts.updateFamilyNote(faceId, note),
          api.fonts.updateFamilyTags(faceId, tags),
        ])
        if (selectedDetail.value?.id === faceId) {
          selectedDetail.value.note = note
          selectedDetail.value.tags = tags
        }
        if (selectedDetailFaceId.value === faceId) {
          detailTags.value = tags
          rememberSavedNote(note, tags, detailLanguage.value)
        }
        await refreshAvailableTags()
        window.clearTimeout(noteSavingTimer)
        noteSavingTimer = undefined
        noteSaveStatus.value = 'saved'
        noteSavedTimer = window.setTimeout(() => {
          if (noteSaveStatus.value === 'saved') noteSaveStatus.value = 'idle'
        }, 1_200)
      } catch (cause) {
        window.clearTimeout(noteSavingTimer)
        noteSavingTimer = undefined
        noteSaveStatus.value = 'idle'
        onError(cause instanceof Error ? cause.message : t('ui.couldNotSaveFontNote'))
      } finally {
        saveNotePromise = null
      }
    })()
    await saveNotePromise
  }

  async function saveDetailLanguage(language: FontLanguage | null) {
    const faceId = selectedDetailFaceId.value
    if (!faceId) return
    const previous = savedLanguage
    detailLanguage.value = language
    if (language === previous) return
    try {
      await api.fonts.updateFamilyLanguage(faceId, language)
      if (selectedDetail.value?.id === faceId) selectedDetail.value.language = language
      if (selectedDetailFaceId.value === faceId) {
        savedLanguage = language
        detailLanguage.value = language
      }
    } catch (cause) {
      if (selectedDetailFaceId.value === faceId) detailLanguage.value = previous
      onError(cause instanceof Error ? cause.message : t('ui.couldNotSaveFontLanguage'))
    }
  }

  async function copyName(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      copiedName.value = value
      window.setTimeout(() => {
        if (copiedName.value === value) copiedName.value = null
      }, 1_500)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('ui.couldNotCopyFontName'))
    }
  }

  async function copyFamilyName(face: FontFaceSummary, mode: FamilyNameMode = 'preferred') {
    try {
      await navigator.clipboard.writeText(displayFamily(face, mode))
      copiedFamily.value = face.id
      window.setTimeout(() => {
        if (copiedFamily.value === face.id) copiedFamily.value = null
      }, 1_500)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('ui.couldNotCopyFontName'))
    }
  }

  async function copyFaceName(
    face: FontFaceSummary,
    type: CopyNameType,
    language: CopyNameLanguage,
    detail?: FontFaceDetail | null,
  ) {
    let resolved = detail ?? (selectedDetail.value?.id === face.id ? selectedDetail.value : null)
    if (!resolved && type === 'fullName') {
      try {
        resolved = await api.fonts.details(face.id)
      } catch {
        resolved = null
      }
    }
    const value = resolveCopyName(face, type, language, resolved)
    if (!value) {
      onError(t('ui.noFontNameToCopy'))
      return
    }
    await copyName(value)
  }

  async function toggleFavorite(face: FontFaceSummary) {
    const favorite = !face.favorite
    await api.fonts.updateUserData({ faceId: face.id, favorite })
    for (const collection of [faces.value, familyFaces.value]) {
      const matchingFace = collection.find(item => item.id === face.id)
      if (matchingFace) matchingFace.favorite = favorite
    }
    if (!favorite && filters.libraryView.value === 'favorites' && !selectedFamily.value) {
      faces.value = faces.value.filter(item => item.id !== face.id)
    }
  }

  watch(
    [
      filters.text,
      filters.libraryView,
      filters.weight,
      filters.italic,
      filters.variable,
      filters.languages,
      filters.tags,
      filters.formats,
      filters.glyphCountMin,
      filters.glyphCountMax,
      filters.groupByFamily,
      filters.rootId,
      filters.pathPrefix,
    ],
    () => {
      window.clearTimeout((refresh as typeof refresh & { timer?: number }).timer)
      ;(refresh as typeof refresh & { timer?: number }).timer = window.setTimeout(refresh, FILTER_REFRESH_DELAY)
    },
    { deep: true },
  )
  watch(filters.activeFaceIds, () => {
    if (filters.libraryView.value !== 'active' && filters.libraryView.value !== 'inactive') return
    window.clearTimeout((refresh as typeof refresh & { timer?: number }).timer)
    ;(refresh as typeof refresh & { timer?: number }).timer = window.setTimeout(refresh, FILTER_REFRESH_DELAY)
  })
  watch(selectedDetailFaceId, faceId => {
    if (faceId) void loadDetail(faceId)
  })

  return {
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
    loadDetail,
    refreshAvailableTags,
    saveDetailNote,
    saveDetailLanguage,
    copyName,
    copyFamilyName,
    copyFaceName,
    toggleFavorite,
    queryInput,
    linkedDisplayQuery,
  }
}
