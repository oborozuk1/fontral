import { shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import type { FontFaceSummary } from '@fontral/contracts'
import { mergePreviewGlyphText, PREVIEW_LATIN_BASE, subsetCoversPreview } from '../../../shared/preview-subset-text'
import {
  PREVIEW_CACHE_MAX_DEFAULT,
  PREVIEW_CACHE_MAX_MAX,
  PREVIEW_CACHE_MAX_MIN,
  type FamilyNameMode,
} from './useSettings'
import { displayFamily } from './useFonts'
import { useI18n, type TranslationKey } from './useI18n'

const LOAD_DELAY_MS = 80
const SCROLL_IDLE_MS = 140
const MAX_CONCURRENT = 3
const ROOT_MARGIN = '80px 0px'
const EVICT_IDLE_MS = 500
const TEXT_REFRESH_MS = 80
/** Parallel cmap/coverage IPC while applying a preview-text change. */
const TEXT_RESOLVE_CONCURRENCY = 12
/** Main process replaces missing glyphs with this noncharacter in previewText(). */
const MISSING_GLYPH = '\uFDD0'

type ResolvedPreview = {
  source: string
  mapped: string
  needed: string
  covers: boolean
}

export function fontPreviewSource(
  face: Pick<FontFaceSummary, 'id'>,
  text: string,
  options?: { full?: boolean },
) {
  // Subset is keyed by face + preview text; full mode loads the extracted face once.
  // No TTC fragment needed (main extracts faceIndex).
  const params = new URLSearchParams()
  if (options?.full) params.set('full', '1')
  else if (text) params.set('t', text)
  const query = params.toString()
  return `url("font-preview://face/${face.id}${query ? `?${query}` : ''}")`
}

/** Glyphs baked by main-process subset (requested + default Latin). */
function bakedSubsetText(...parts: string[]) {
  return mergePreviewGlyphText(...parts, PREVIEW_LATIN_BASE)
}

function previewLoadErrorMessage(error: unknown, t: (key: TranslationKey) => string) {
  const message = error instanceof Error ? error.message.trim() : ''
  // Chromium hides OTS table diagnostics behind a generic NetworkError.
  if (!message || /network error|failed to load/i.test(message)) {
    return t('ui.couldNotParseThisFontPreviewTheFontFileMayContainCorruptedTables')
  }
  return `${t('ui.fontPreviewFailedToLoad')}${message}`
}

export function useFontPreview(
  api: typeof window.fontral,
  displayedFaces: ComputedRef<FontFaceSummary[]>,
  previewText: Ref<string>,
  lazyPreview: Ref<boolean>,
  familyNameMode: Ref<FamilyNameMode>,
  prefetchAhead: Ref<number>,
  /** Max decoded FontFace entries retained in renderer memory. */
  previewCacheMax: Ref<number>,
  /** Load full faces instead of text-keyed subsets. */
  fullPreview: Ref<boolean>,
  /** Maximum concurrent Chromium decodes for full-face previews. */
  fullPreviewConcurrent: Ref<number>,
) {
  const { t } = useI18n()
  /** Insertion order = LRU (oldest first). */
  const loaded = shallowRef(new Map<number, FontFace>())
  const failed = shallowRef(new Map<number, string>())
  const renderedPreviewText = shallowRef(new Map<number, string>())
  /** faceId -> covers current preview text fully (only set after previewText IPC). */
  const coversPreview = shallowRef(new Map<number, boolean>())
  /** Glyphs currently baked into the loaded subset FontFace. */
  const loadedSubsetText = new Map<number, string>()
  /** Desired subset when expanding an existing face after preview-text change. */
  const pendingSubsetMerge = new Map<number, string>()
  /** Pre-resolved coverage from text refresh — avoids a second previewText IPC in runLoad. */
  const pendingResolved = new Map<number, ResolvedPreview>()
  let previewObserver: IntersectionObserver | undefined
  let scrollRoot: HTMLElement | null = null
  let loadGeneration = 0
  let textRefreshSeq = 0
  let scrollIdleTimer: number | undefined
  let evictTimer: number | undefined
  let textRefreshTimer: number | undefined

  const pendingTimers = new Map<number, number>()
  const queued = new Map<number, FontFaceSummary>()
  const prefetchQueued = new Map<number, FontFaceSummary>()
  const inFlight = new Set<number>()
  const visibleIds = new Set<number>()
  const observedElements = new Map<number, Element>()
  let notifyLoadedFrame = 0
  let notifyTextFrame = 0
  let notifyCoversFrame = 0
  let loadedDirty = false
  let textDirty = false
  let coversDirty = false

  function faceById(faceId: number) {
    return displayedFaces.value.find(item => item.id === faceId)
  }

  function faceIndex(faceId: number) {
    return displayedFaces.value.findIndex(item => item.id === faceId)
  }

  function cacheLimit() {
    const value = Math.round(previewCacheMax.value)
    if (!Number.isFinite(value)) return PREVIEW_CACHE_MAX_DEFAULT
    return Math.min(PREVIEW_CACHE_MAX_MAX, Math.max(PREVIEW_CACHE_MAX_MIN, value))
  }

  function concurrentLoadLimit() {
    // Decoding full font files is expensive in Chromium; serializing it keeps scrolling responsive.
    return fullPreview.value ? Math.max(1, Math.round(fullPreviewConcurrent.value)) : MAX_CONCURRENT
  }

  function flushLoaded() {
    notifyLoadedFrame = 0
    if (!loadedDirty) return
    loadedDirty = false
    loaded.value = new Map(loaded.value)
  }

  function flushText() {
    notifyTextFrame = 0
    if (!textDirty) return
    textDirty = false
    renderedPreviewText.value = new Map(renderedPreviewText.value)
  }

  function flushCovers() {
    notifyCoversFrame = 0
    if (!coversDirty) return
    coversDirty = false
    coversPreview.value = new Map(coversPreview.value)
  }

  function scheduleLoadedNotify() {
    loadedDirty = true
    if (notifyLoadedFrame) return
    notifyLoadedFrame = window.requestAnimationFrame(flushLoaded)
  }

  function scheduleTextNotify() {
    textDirty = true
    if (notifyTextFrame) return
    notifyTextFrame = window.requestAnimationFrame(flushText)
  }

  function scheduleCoversNotify() {
    coversDirty = true
    if (notifyCoversFrame) return
    notifyCoversFrame = window.requestAnimationFrame(flushCovers)
  }

  function setCovers(faceId: number, covers: boolean) {
    if (coversPreview.value.get(faceId) === covers) return
    coversPreview.value.set(faceId, covers)
    scheduleCoversNotify()
  }

  function touchLoaded(faceId: number) {
    const font = loaded.value.get(faceId)
    if (!font) return
    loaded.value.delete(faceId)
    loaded.value.set(faceId, font)
  }

  function cancelPending(faceId: number) {
    const timer = pendingTimers.get(faceId)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      pendingTimers.delete(faceId)
    }
    queued.delete(faceId)
  }

  function unobserveFace(faceId: number) {
    const element = observedElements.get(faceId)
    if (!element) return
    previewObserver?.unobserve(element)
    observedElements.delete(faceId)
  }

  function dropFont(faceId: number, options?: { clearCovers?: boolean; keepText?: boolean }) {
    const old = loaded.value.get(faceId)
    if (old) {
      try { document.fonts.delete(old) } catch { /* ignore */ }
      loaded.value.delete(faceId)
      loadedDirty = true
    }
    loadedSubsetText.delete(faceId)
    if (!options?.keepText && renderedPreviewText.value.delete(faceId)) textDirty = true
    if (failed.value.delete(faceId)) failed.value = new Map(failed.value)
    // Keep coverage results across font-cache eviction so filtered cards stay hidden/shown.
    if (options?.clearCovers && coversPreview.value.delete(faceId)) coversDirty = true
  }

  function evictIfNeeded() {
    const limit = cacheLimit()
    if (loaded.value.size <= limit) return

    // Never drop currently visible faces. Prefer reclaiming faces that failed coverage
    // (already hidden) before faces still shown by the coverage filter.
    const candidates = [...loaded.value.keys()].filter(id => !visibleIds.has(id))
    candidates.sort((a, b) => {
      const rank = (id: number) => (coversPreview.value.get(id) === true ? 1 : 0)
      return rank(a) - rank(b)
    })
    for (const id of candidates) {
      if (loaded.value.size <= limit) break
      dropFont(id)
      pendingSubsetMerge.delete(id)
    }

    if (loadedDirty) scheduleLoadedNotify()
    if (textDirty) scheduleTextNotify()
  }

  function scheduleEvict() {
    window.clearTimeout(evictTimer)
    evictTimer = window.setTimeout(() => {
      evictTimer = undefined
      evictIfNeeded()
    }, EVICT_IDLE_MS)
  }

  watch(previewCacheMax, () => scheduleEvict())

  function visibleIndexRange() {
    let min = Number.POSITIVE_INFINITY
    let max = -1
    for (const id of visibleIds) {
      const index = faceIndex(id)
      if (index < 0) continue
      if (index < min) min = index
      if (index > max) max = index
    }
    if (max < 0 || !Number.isFinite(min)) return null
    return { min, max }
  }

  function previewSource(face: FontFaceSummary) {
    return previewText.value || displayFamily(face, familyNameMode.value)
  }

  async function resolveMappedText(face: FontFaceSummary): Promise<ResolvedPreview> {
    const source = previewSource(face)
    try {
      const mapped = await api.fonts.previewText(face.id, source)
      return {
        source,
        mapped,
        needed: mapped.split(MISSING_GLYPH).join('') || ' ',
        covers: !mapped.includes(MISSING_GLYPH),
      }
    } catch {
      return {
        source,
        mapped: source,
        needed: source || ' ',
        covers: true,
      }
    }
  }

  function takePendingResolved(face: FontFaceSummary): ResolvedPreview | undefined {
    const pending = pendingResolved.get(face.id)
    if (!pending) return undefined
    if (pending.source !== previewSource(face)) {
      pendingResolved.delete(face.id)
      return undefined
    }
    pendingResolved.delete(face.id)
    return pending
  }

  async function updatePreviewText(face: FontFaceSummary) {
    const result = await resolveMappedText(face)
    if (result.source !== previewSource(face)) return
    if (!loaded.value.has(face.id)) return
    setCovers(face.id, result.covers)
      if (!fullPreview.value) {
      const currentSubset = loadedSubsetText.get(face.id) ?? ''
      if (!subsetCoversPreview(currentSubset, result.needed)) return
    }
    commitRenderedText(face.id, result.mapped)
  }

  function commitRenderedText(faceId: number, mapped: string) {
    if (renderedPreviewText.value.get(faceId) === mapped) return
    renderedPreviewText.value.set(faceId, mapped)
    scheduleTextNotify()
  }

  async function runLoad(face: FontFaceSummary, generation: number, kind: 'visible' | 'prefetch') {
    const expanding = pendingSubsetMerge.has(face.id) || loaded.value.has(face.id)
    // First load: skip if already present. Expand/reload: allow even when loaded (atomic swap).
    if (!expanding && (loaded.value.has(face.id) || failed.value.has(face.id))) return
    if (inFlight.has(face.id)) return
    if (lazyPreview.value && kind === 'visible' && !visibleIds.has(face.id) && !pendingSubsetMerge.has(face.id)) return

    inFlight.add(face.id)
    const family = `fontral_${face.id}`
    const previous = loaded.value.get(face.id)
    try {
      const resolved = takePendingResolved(face) ?? await resolveMappedText(face)
      if (generation !== loadGeneration) return
      if (resolved.source !== previewSource(face)) return
      setCovers(face.id, resolved.covers)

      const merge = pendingSubsetMerge.get(face.id) ?? (expanding ? loadedSubsetText.get(face.id) : undefined)
      pendingSubsetMerge.delete(face.id)
      const subsetText = fullPreview.value
        ? '\u0000full'
        : bakedSubsetText(merge ?? '', resolved.needed)

      // Already covers (e.g. text shrank / full face): keep current face, just refresh label.
      if (previous && (fullPreview.value || subsetCoversPreview(loadedSubsetText.get(face.id) ?? '', resolved.needed))) {
        if (fullPreview.value) loadedSubsetText.set(face.id, subsetText)
        commitRenderedText(face.id, resolved.mapped)
        touchLoaded(face.id)
        return
      }

      const font = new FontFace(
        family,
        // Main always merges Latin base; send full baked set so cache keys stay stable.
        fontPreviewSource(face, fullPreview.value ? '' : subsetText, { full: fullPreview.value }),
      )
      const ready = await font.load()
      if (generation !== loadGeneration) {
        try { document.fonts.delete(ready) } catch { /* ignore */ }
        return
      }
      if (lazyPreview.value && !visibleIds.has(face.id) && !previous) {
        try { document.fonts.delete(ready) } catch { /* ignore */ }
        return
      }
      if (resolved.source !== previewSource(face)) {
        try { document.fonts.delete(ready) } catch { /* ignore */ }
        return
      }
      // Atomic swap: add new face first, then drop old — avoids Loading... flash.
      document.fonts.add(ready)
      if (previous && previous !== ready) {
        try { document.fonts.delete(previous) } catch { /* ignore */ }
      }
      loaded.value.set(face.id, ready)
      loadedSubsetText.set(face.id, subsetText)
      // Only show the new text after the subset that can draw it is installed.
      commitRenderedText(face.id, resolved.mapped)
      if (failed.value.delete(face.id)) failed.value = new Map(failed.value)
      evictIfNeeded()
      scheduleLoadedNotify()
    } catch (error) {
      if (generation !== loadGeneration) return
      // Keep previous preview if expand failed.
      if (previous) {
        loaded.value.set(face.id, previous)
        scheduleLoadedNotify()
        return
      }
      failed.value.set(face.id, previewLoadErrorMessage(error, t))
      failed.value = new Map(failed.value)
    } finally {
      inFlight.delete(face.id)
      if (generation === loadGeneration) {
        // Text changed mid-flight (or expand raced an in-flight load): retry if still needed.
        const needsRetry = pendingSubsetMerge.has(face.id)
          || (
            !loaded.value.has(face.id)
            && !failed.value.has(face.id)
            && !queued.has(face.id)
            && (!lazyPreview.value || visibleIds.has(face.id))
          )
        if (needsRetry) queued.set(face.id, face)
        pumpQueue()
      }
    }
  }

  function takeNextVisible(): FontFaceSummary | undefined {
    // Prefer currently visible cards so the viewport updates before off-screen expands.
    for (const [id, face] of queued) {
      if (visibleIds.has(id)) {
        queued.delete(id)
        return face
      }
    }
    for (const [id, face] of queued) {
      if (!lazyPreview.value) {
        queued.delete(id)
        return face
      }
    }
    if (lazyPreview.value) queued.clear()
    return undefined
  }

  function takeNextPrefetch(): FontFaceSummary | undefined {
    if (loaded.value.size + inFlight.size >= cacheLimit()) {
      prefetchQueued.clear()
      return undefined
    }
    while (prefetchQueued.size) {
      const first = prefetchQueued.entries().next().value as [number, FontFaceSummary] | undefined
      if (!first) return undefined
      prefetchQueued.delete(first[0])
      if (loaded.value.has(first[0]) || inFlight.has(first[0]) || !faceById(first[0])) continue
      return first[1]
    }
    return undefined
  }

  function pumpQueue() {
    while (inFlight.size < concurrentLoadLimit()) {
      const visible = takeNextVisible()
      if (visible) {
        if (inFlight.has(visible.id)) continue
        // Allow expand even when a face is already loaded.
        if (loaded.value.has(visible.id) && !pendingSubsetMerge.has(visible.id)) continue
        void runLoad(visible, loadGeneration, 'visible')
        continue
      }
      const prefetch = takeNextPrefetch()
      if (!prefetch) break
      void runLoad(prefetch, loadGeneration, 'prefetch')
    }
  }

  function enqueueLoad(face: FontFaceSummary, options?: { force?: boolean }) {
    if (inFlight.has(face.id) || queued.has(face.id)) return
    if (!options?.force && (loaded.value.has(face.id) || failed.value.has(face.id))) return
    if (options?.force && failed.value.delete(face.id)) failed.value = new Map(failed.value)
    prefetchQueued.delete(face.id)
    queued.set(face.id, face)
    pumpQueue()
  }

  function enqueuePrefetch(face: FontFaceSummary) {
    if (loaded.value.has(face.id) || failed.value.has(face.id) || inFlight.has(face.id) || queued.has(face.id) || prefetchQueued.has(face.id)) return
    if (visibleIds.has(face.id)) {
      enqueueLoad(face)
      return
    }
    if (loaded.value.size + inFlight.size >= cacheLimit()) return
    prefetchQueued.set(face.id, face)
    pumpQueue()
  }

  function scheduleLoad(face: FontFaceSummary) {
    if (loaded.value.has(face.id) || failed.value.has(face.id) || inFlight.has(face.id) || pendingTimers.has(face.id) || queued.has(face.id)) return
    if (!lazyPreview.value) {
      enqueueLoad(face)
      return
    }
    const timer = window.setTimeout(() => {
      pendingTimers.delete(face.id)
      if (!visibleIds.has(face.id)) return
      enqueueLoad(face)
    }, LOAD_DELAY_MS)
    pendingTimers.set(face.id, timer)
  }

  function observePreview(element: unknown, face: FontFaceSummary) {
    if (!(element instanceof Element)) return
    visibleIds.add(face.id)
    if (failed.value.has(face.id)) return
    if (loaded.value.has(face.id)) {
      touchLoaded(face.id)
      // A text change while this card was hidden may need a larger subset. Lazy
      // loading drops its invisible queue entry, so resume it when the card returns.
      if (pendingSubsetMerge.has(face.id)) enqueueLoad(face, { force: true })
      if (!renderedPreviewText.value.has(face.id)) void updatePreviewText(face)
      return
    }
    if (lazyPreview.value) {
      ;(element as HTMLElement).dataset.faceId = String(face.id)
      const previous = observedElements.get(face.id)
      if (previous && previous !== element) previewObserver?.unobserve(previous)
      observedElements.set(face.id, element)
      previewObserver?.observe(element)
    } else {
      scheduleLoad(face)
    }
  }

  function leavePreview(face: FontFaceSummary) {
    visibleIds.delete(face.id)
    cancelPending(face.id)
    unobserveFace(face.id)
    queued.delete(face.id)
    prefetchQueued.delete(face.id)
    // Do not evict here: virtual list / family navigation unmounts cards in bulk.
    // Size-based eviction runs on load and scroll-idle only.
  }

  function lastVisibleIndex() {
    const range = visibleIndexRange()
    return range ? range.max : -1
  }

  function prefetchBelowVisible() {
    if (!lazyPreview.value) return
    const count = Math.min(24, Math.max(0, Math.round(prefetchAhead.value)))
    if (!count) {
      prefetchQueued.clear()
      return
    }
    if (loaded.value.size + inFlight.size >= cacheLimit()) return
    const start = lastVisibleIndex()
    if (start < 0) return
    const faces = displayedFaces.value
    const end = Math.min(faces.length, start + 1 + count)
    for (let i = start + 1; i < end; i += 1) {
      const face = faces[i]
      if (face) enqueuePrefetch(face)
    }
  }

  function onScrollIdle() {
    scrollIdleTimer = undefined
    prefetchBelowVisible()
    scheduleEvict()
  }

  function onScrollRoot() {
    prefetchQueued.clear()
    window.clearTimeout(scrollIdleTimer)
    scrollIdleTimer = window.setTimeout(onScrollIdle, SCROLL_IDLE_MS)
  }

  function bindScrollRoot(root: HTMLElement | null) {
    if (scrollRoot) scrollRoot.removeEventListener('scroll', onScrollRoot)
    scrollRoot = root
    if (root) root.addEventListener('scroll', onScrollRoot, { passive: true })
  }

  function resetPendingWork() {
    loadGeneration += 1
    textRefreshSeq += 1
    for (const timer of pendingTimers.values()) window.clearTimeout(timer)
    pendingTimers.clear()
    queued.clear()
    prefetchQueued.clear()
    pendingSubsetMerge.clear()
    pendingResolved.clear()
    inFlight.clear()
    window.clearTimeout(scrollIdleTimer)
    scrollIdleTimer = undefined
    window.clearTimeout(evictTimer)
    evictTimer = undefined
    window.clearTimeout(textRefreshTimer)
    textRefreshTimer = undefined
    if (notifyLoadedFrame) {
      window.cancelAnimationFrame(notifyLoadedFrame)
      notifyLoadedFrame = 0
    }
    if (notifyTextFrame) {
      window.cancelAnimationFrame(notifyTextFrame)
      notifyTextFrame = 0
    }
    if (notifyCoversFrame) {
      window.cancelAnimationFrame(notifyCoversFrame)
      notifyCoversFrame = 0
    }
    loadedDirty = false
    textDirty = false
    coversDirty = false
  }

  function purgeLoadedFonts() {
    resetPendingWork()
    for (const id of [...loaded.value.keys()]) dropFont(id, { clearCovers: true })
    loaded.value = new Map()
    failed.value = new Map()
    renderedPreviewText.value = new Map()
    coversPreview.value = new Map()
    loadedSubsetText.clear()
    for (const id of [...visibleIds]) {
      const face = faceById(id)
      if (face) enqueueLoad(face)
    }
  }

  /** Drop previews that are no longer in the working set; keep hits. */
  function pruneToFaces(faces: FontFaceSummary[]) {
    const keep = new Set(faces.map(face => face.id))
    let dropped = false
    for (const id of [...loaded.value.keys()]) {
      if (keep.has(id)) continue
      dropFont(id, { clearCovers: true })
      pendingSubsetMerge.delete(id)
      dropped = true
    }
    // Drop stale coverage for faces that left the query result.
    for (const id of [...coversPreview.value.keys()]) {
      if (keep.has(id)) continue
      coversPreview.value.delete(id)
      coversDirty = true
      dropped = true
    }
    for (const id of [...failed.value.keys()]) {
      if (keep.has(id)) continue
      failed.value.delete(id)
      dropped = true
    }
    if (dropped) failed.value = new Map(failed.value)
    // Cancel pending work for faces that left the list.
    for (const id of [...queued.keys()]) if (!keep.has(id)) cancelPending(id)
    for (const id of [...prefetchQueued.keys()]) if (!keep.has(id)) prefetchQueued.delete(id)
    for (const id of [...pendingTimers.keys()]) if (!keep.has(id)) cancelPending(id)
    for (const id of [...pendingSubsetMerge.keys()]) if (!keep.has(id)) pendingSubsetMerge.delete(id)
    for (const id of [...pendingResolved.keys()]) if (!keep.has(id)) pendingResolved.delete(id)
    if (dropped) {
      if (loadedDirty) scheduleLoadedNotify()
      if (textDirty) scheduleTextNotify()
      if (coversDirty) scheduleCoversNotify()
    }
    scheduleEvict()
  }

  async function clearPreviewCache() {
    purgeLoadedFonts()
    try {
      await api.fonts.clearPreviewCache()
    } catch { /* best-effort */ }
  }

  function onIntersect(entries: IntersectionObserverEntry[]) {
    let becameVisible = false
    for (const entry of entries) {
      const faceId = Number((entry.target as HTMLElement).dataset.faceId)
      if (!Number.isFinite(faceId)) continue

      if (!entry.isIntersecting) {
        visibleIds.delete(faceId)
        cancelPending(faceId)
        continue
      }

      becameVisible = true
      visibleIds.add(faceId)
      observedElements.set(faceId, entry.target)
      if (loaded.value.has(faceId)) {
        touchLoaded(faceId)
        continue
      }
      if (failed.value.has(faceId)) continue
      if (inFlight.has(faceId) || queued.has(faceId) || pendingTimers.has(faceId)) continue

      const face = faceById(faceId)
      if (!face) continue
      scheduleLoad(face)
    }
    if (becameVisible) {
      window.clearTimeout(scrollIdleTimer)
      scrollIdleTimer = window.setTimeout(onScrollIdle, SCROLL_IDLE_MS)
    }
  }

  function setupObserver(root: HTMLElement | null) {
    previewObserver?.disconnect()
    observedElements.clear()
    bindScrollRoot(root)
    previewObserver = new IntersectionObserver(onIntersect, { root, rootMargin: ROOT_MARGIN, threshold: 0 })
  }

  function disconnectObserver() {
    resetPendingWork()
    for (const id of [...loaded.value.keys()]) dropFont(id, { clearCovers: true })
    loaded.value = new Map()
    failed.value = new Map()
    renderedPreviewText.value = new Map()
    coversPreview.value = new Map()
    loadedSubsetText.clear()
    visibleIds.clear()
    observedElements.clear()
    bindScrollRoot(null)
    previewObserver?.disconnect()
    previewObserver = undefined
  }

  /** List data changed (append / family navigate). Keep decoded previews. */
  function refreshVisiblePreviews(_faces?: FontFaceSummary[]) {
    // Intentionally no purge: open/close family and pagination must retain cache.
  }

  async function applyPreviewTextChange(seq: number) {
    // Recompute coverage for loaded/visible faces. Visible first, resolve in parallel batches,
    // and kick off expands as soon as each batch finishes (don't wait for the whole list).
    const targets = [...new Set<number>([...visibleIds, ...loaded.value.keys()])]
    targets.sort((a, b) => {
      const av = visibleIds.has(a) ? 0 : 1
      const bv = visibleIds.has(b) ? 0 : 1
      if (av !== bv) return av - bv
      return a - b
    })

    for (let offset = 0; offset < targets.length; offset += TEXT_RESOLVE_CONCURRENCY) {
      if (seq !== textRefreshSeq) return
      const chunk = targets.slice(offset, offset + TEXT_RESOLVE_CONCURRENCY)
      const resolvedChunk = await Promise.all(chunk.map(async id => {
        const face = faceById(id)
        if (!face) return null
        try {
          return { id, face, resolved: await resolveMappedText(face) }
        } catch {
          return null
        }
      }))
      if (seq !== textRefreshSeq) return

      for (const item of resolvedChunk) {
        if (!item) continue
        const { id, face, resolved } = item
        if (resolved.source !== previewSource(face)) continue

        setCovers(id, resolved.covers)

        if (!loaded.value.has(id)) {
          commitRenderedText(id, resolved.mapped)
          if (visibleIds.has(id) && !failed.value.has(id)) {
            pendingResolved.set(id, resolved)
            enqueueLoad(face, { force: true })
          }
          continue
        }

        if (fullPreview.value || subsetCoversPreview(loadedSubsetText.get(id) ?? '', resolved.needed)) {
          commitRenderedText(id, resolved.mapped)
          touchLoaded(id)
          continue
        }

        // Keep old label until expand finishes; pass resolved data to skip a second IPC.
        const currentSubset = loadedSubsetText.get(id) ?? ''
        pendingSubsetMerge.set(id, bakedSubsetText(currentSubset, resolved.needed))
        pendingResolved.set(id, resolved)
        enqueueLoad(face, { force: true })
      }
    }
  }

  function refreshLoadedPreviewTexts() {
    // Debounce while typing; reuse loaded subsets when they already cover the new text.
    window.clearTimeout(textRefreshTimer)
    const seq = ++textRefreshSeq
    textRefreshTimer = window.setTimeout(() => {
      textRefreshTimer = undefined
      void applyPreviewTextChange(seq)
    }, TEXT_REFRESH_MS)
  }

  watch(fullPreview, () => {
    // Mode switch invalidates decoded faces (subset vs full URL).
    purgeLoadedFonts()
  })

  return {
    loaded,
    failed,
    renderedPreviewText,
    coversPreview,
    observePreview,
    leavePreview,
    clearPreviewCache,
    purgeLoadedFonts,
    pruneToFaces,
    setupObserver,
    disconnectObserver,
    refreshVisiblePreviews,
    refreshLoadedPreviewTexts,
  }
}
