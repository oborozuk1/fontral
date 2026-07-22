<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CHARSET_PAGE_SIZE_DEFAULT, type CharsetCharsResult, type FontFaceDetail } from '@fontral/contracts'
import ToggleSwitch from './ToggleSwitch.vue'
import FancyScrollbar from './FancyScrollbar.vue'
import { fontPreviewSource } from '../composables/useFontPreview'
import { translateExternal, useI18n } from '../composables/useI18n'

const props = defineProps<{
  selectedDetail: FontFaceDetail | null
}>()

const emit = defineEmits<{
  error: [message: string]
}>()

const { t } = useI18n()

const charsetModal = ref<{ source: 'unicode' | 'cjk'; key: string; title: string } | null>(null)
const charsetLoading = ref(false)
const charsetResult = ref<CharsetCharsResult | null>(null)
const charsetError = ref('')
const charsetOnlyInFont = ref(true)
const charsetPage = ref(1)
const charsetCopied = ref<string | null>(null)
const charsetGridRef = ref<HTMLElement | null>(null)
const charsetBodyRef = ref<HTMLElement | null>(null)
const charsetBodyInnerRef = ref<HTMLElement | null>(null)
const charsetBodyHeight = ref<number | null>(null)
let charsetCopiedTimer: number | undefined
let charsetLoadSeq = 0
let charsetBodyObserver: ResizeObserver | null = null
let charsetBackdropPointerId: number | null = null
const CHARSET_BODY_MIN = 280
const charsetFontFamilyName = ref<string | null>(null)
const previewFontFamily = computed(() =>
  charsetFontFamilyName.value
    ? `${charsetFontFamilyName.value}, "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif`
    : 'system-ui, sans-serif'
)

const charsetBodyStyle = computed(() => ({
  height: `${charsetBodyHeight.value ?? CHARSET_BODY_MIN}px`,
  minHeight: `${CHARSET_BODY_MIN}px`,
}))

function syncCharsetBodyHeight() {
  const inner = charsetBodyInnerRef.value
  if (!inner) return
  const next = Math.max(CHARSET_BODY_MIN, Math.ceil(inner.getBoundingClientRect().height))
  if (charsetBodyHeight.value === next) return
  charsetBodyHeight.value = next
}

function ensureCharsetBodyObserver() {
  if (charsetBodyObserver || typeof ResizeObserver === 'undefined') return
  charsetBodyObserver = new ResizeObserver(() => {
    syncCharsetBodyHeight()
  })
}

watch(charsetBodyInnerRef, (el, prev) => {
  ensureCharsetBodyObserver()
  if (prev) charsetBodyObserver?.unobserve(prev)
  if (el) {
    charsetBodyObserver?.observe(el)
    void nextTick(() => syncCharsetBodyHeight())
  }
})

const charsetPageLabel = computed(() => {
  const result = charsetResult.value
  if (!result) return ''
    return t('charset.pageLabel', { page: result.page, pageCount: result.pageCount })
})

function formatCp(codePoint: number) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(codePoint > 0xffff ? 5 : 4, '0')}`
}

function onCharsetBackdropPointerDown(event: PointerEvent) {
  charsetBackdropPointerId = event.target === event.currentTarget && event.button === 0 ? event.pointerId : null
}

function onCharsetBackdropPointerUp(event: PointerEvent) {
  const shouldClose = charsetBackdropPointerId === event.pointerId && event.target === event.currentTarget
  charsetBackdropPointerId = null
  if (shouldClose) closeCharsetViewer()
}

function resetCharsetBackdropPointer() {
  charsetBackdropPointerId = null
}

function dropCharsetFont() {
  if (!charsetFontFamilyName.value) return
  for (const font of [...document.fonts]) {
    if (font.family === charsetFontFamilyName.value) {
      try { document.fonts.delete(font) } catch { /* ignore */ }
    }
  }
  charsetFontFamilyName.value = null
}

async function ensureCharsetPreviewFont(faceId: number, chars: string) {
  const selected = props.selectedDetail
  if (!selected || selected.id !== faceId) return
  const text = chars || ' '
  const family = `fontral_cs_${faceId}_${text.length}`
  dropCharsetFont()
  try {
    const face = new FontFace(family, fontPreviewSource(selected, text))
    const ready = await face.load()
    document.fonts.add(ready)
    charsetFontFamilyName.value = family
  } catch {
    charsetFontFamilyName.value = null
  }
}

async function loadCharsetPage(page = charsetPage.value) {
  const modal = charsetModal.value
  const faceId = props.selectedDetail?.id
  if (!modal || !faceId) return
  const seq = ++charsetLoadSeq
  charsetLoading.value = true
  charsetError.value = ''
  try {
    const result = await window.fontral.fonts.charsetChars({
      faceId,
      source: modal.source,
      key: modal.key,
      page,
      pageSize: CHARSET_PAGE_SIZE_DEFAULT,
      onlyInFont: charsetOnlyInFont.value,
    })
    if (seq !== charsetLoadSeq) return
    charsetResult.value = result
    charsetPage.value = result.page
    const pageText = result.chars.map(item => item.char).filter(Boolean).join('')
    await ensureCharsetPreviewFont(faceId, pageText)
    if (seq !== charsetLoadSeq) return
    await nextTick()
    charsetGridRef.value?.scrollTo({ top: 0 })
  } catch (cause) {
    if (seq !== charsetLoadSeq) return
    charsetError.value = cause instanceof Error ? cause.message : t('ui.couldNotReadCharacterSet')
  } finally {
    if (seq === charsetLoadSeq) charsetLoading.value = false
  }
}

async function openCharsetViewer(source: 'unicode' | 'cjk', key: string, title: string) {
  const faceId = props.selectedDetail?.id
  if (!faceId) return
  charsetModal.value = { source, key, title }
  charsetPage.value = 1
  charsetOnlyInFont.value = true
  charsetResult.value = null
  charsetError.value = ''
  charsetLoading.value = true
  try {
    await loadCharsetPage(1)
  } catch (cause) {
    charsetError.value = cause instanceof Error ? cause.message : t('ui.couldNotReadCharacterSet')
    charsetLoading.value = false
  }
}

function closeCharsetViewer() {
  charsetLoadSeq++
  dropCharsetFont()
  charsetModal.value = null
  charsetResult.value = null
  charsetError.value = ''
  charsetLoading.value = false
  charsetOnlyInFont.value = true
  charsetPage.value = 1
  charsetBodyHeight.value = null
}

function goCharsetPage(delta: number) {
  const result = charsetResult.value
  if (!result) return
  const next = Math.min(result.pageCount, Math.max(1, result.page + delta))
  if (next === result.page) return
  void loadCharsetPage(next)
}

watch(charsetOnlyInFont, () => {
  if (!charsetModal.value) return
  charsetPage.value = 1
  void loadCharsetPage(1)
})

async function copyCharsetPart(value: string, key: string) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    charsetCopied.value = key
    window.clearTimeout(charsetCopiedTimer)
    charsetCopiedTimer = window.setTimeout(() => {
      if (charsetCopied.value === key) charsetCopied.value = null
    }, 1_200)
  } catch {
    emit('error', t('ui.couldNotCopy'))
  }
}

function onCharsetGlobalKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && charsetModal.value) closeCharsetViewer()
}

onMounted(() => {
  window.addEventListener('keydown', onCharsetGlobalKey, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onCharsetGlobalKey, true)
  window.clearTimeout(charsetCopiedTimer)
  charsetBodyObserver?.disconnect()
  charsetBodyObserver = null
  dropCharsetFont()
})

defineExpose({
  open: openCharsetViewer,
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="charsetModal" class="modal-backdrop charset-modal-backdrop" @pointerdown="onCharsetBackdropPointerDown" @pointerup="onCharsetBackdropPointerUp" @pointercancel="resetCharsetBackdropPointer">
        <section class="modal charset-modal" role="dialog" aria-modal="true" :aria-label="charsetModal.title">
          <div class="charset-modal-head">
            <div>
              <p class="modal-eyebrow">{{ t('ui.characterSet') }}</p>
              <h2>{{ translateExternal(charsetResult?.title || charsetModal.title) }}</h2>
              <p v-if="charsetResult" class="charset-modal-summary">
                {{ charsetResult.pageCount > 1
                  ? t('charset.pageSummary', { covered: charsetResult.covered, total: charsetResult.total, page: charsetResult.page, pageCount: charsetResult.pageCount })
                  : t('charset.itemSummary', { covered: charsetResult.covered, total: charsetResult.total, count: charsetResult.chars.length }) }}
              </p>
            </div>
            <div class="charset-modal-tools">
              <ToggleSwitch
                v-if="charsetResult || charsetLoading"
                v-model="charsetOnlyInFont"
                class="charset-only-switch"
                :label="t('ui.onlyShowCharactersInFont')"
                :ariaLabel="t('ui.onlyShowCharactersInFont')"
              />
              <button type="button" class="charset-modal-close" :aria-label="t('ui.commonClose')" @click="closeCharsetViewer">×</button>
            </div>
          </div>

          <div ref="charsetBodyRef" class="charset-modal-body" :style="charsetBodyStyle">
            <div ref="charsetBodyInnerRef" class="charset-modal-body-inner">
              <p v-if="charsetLoading && !charsetResult" class="muted charset-modal-status">{{ t('ui.loadingCharacters') }}</p>
              <p v-else-if="charsetError" class="error charset-modal-status">{{ charsetError }}</p>
              <template v-else-if="charsetResult">
                <p v-if="!charsetResult.chars.length" class="muted charset-modal-status">{{ t('ui.noCharactersToDisplay') }}</p>
                <div v-else class="charset-char-grid fancy-scroll" :class="{ 'is-loading': charsetLoading }">
                  <div ref="charsetGridRef" class="charset-char-grid-scroll fancy-scroll__viewport">
                    <article
                      v-for="item in charsetResult.chars"
                      :key="item.codePoint"
                      class="charset-char-card"
                      :class="{ 'is-missing': !item.inFont }"
                    >
                      <button
                        type="button"
                        class="charset-char-glyph"
                        :class="{ 'is-fallback': !item.inFont }"
                        :style="{ fontFamily: item.inFont ? previewFontFamily : undefined }"
                        :data-tooltip="charsetCopied === `g-${item.codePoint}` ? t('ui.copied') : t('ui.copyCharacter')"
                        @click="copyCharsetPart(item.char || formatCp(item.codePoint), `g-${item.codePoint}`)"
                      >{{ item.char || '·' }}</button>
                      <button
                        type="button"
                        class="charset-char-cp"
                        :data-tooltip="charsetCopied === `c-${item.codePoint}` ? t('ui.copied') : t('ui.copyCodePoint')"
                        @click="copyCharsetPart(formatCp(item.codePoint), `c-${item.codePoint}`)"
                      >{{ formatCp(item.codePoint) }}</button>
                    </article>
                  </div>
                  <FancyScrollbar :target="charsetGridRef" :aria-label="t('ui.characterSetScrollbar')" />
                </div>
                <div v-if="charsetResult.pageCount > 1" class="charset-pagination">
                  <button
                    type="button"
                    class="charset-page-btn"
                    :disabled="charsetLoading || charsetResult.page <= 1"
                    @click="goCharsetPage(-1)"
                   >{{ t('ui.previous') }}</button>
                  <span class="charset-page-label">{{ charsetPageLabel }}</span>
                  <button
                    type="button"
                    class="charset-page-btn"
                    :disabled="charsetLoading || charsetResult.page >= charsetResult.pageCount"
                    @click="goCharsetPage(1)"
                   >{{ t('ui.next') }}</button>
                </div>
              </template>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.muted {
  color: var(--ink-5);
}

.error {
  color: var(--danger-ink);
}

/* Shared by the character viewer and the linked-font confirmation dialog. */
.modal-enter-active,
.modal-leave-active {
  transition: opacity .2s ease;
}

.modal-enter-active .modal,
.modal-leave-active .modal {
  transition: opacity .2s ease, transform .2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal,
.modal-leave-to .modal {
  opacity: 0;
  transform: translateY(10px) scale(.96);
}

.charset-modal-backdrop {
  position: fixed;
  z-index: 1200;
  inset: 42px 0 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--overlay);
}

.charset-modal {
  display: flex;
  flex-direction: column;
  width: min(920px, 100%);
  max-height: min(82vh, 860px);
  padding: 22px 22px 16px;
  border: 1px solid var(--modal-border);
  border-radius: 14px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-xl);
}

.charset-modal-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}

.charset-modal-head > div:first-child {
  flex: 1;
  min-width: 0;
}

.charset-modal-tools {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  height: 32px;
}

.charset-only-switch {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  height: 32px;
  margin: 0;
}

.charset-only-switch :deep(.toggle-switch__copy) {
  display: flex;
  align-items: center;
}

.charset-only-switch :deep(.toggle-switch__label) {
  color: var(--ink-4);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.charset-only-switch :deep(.toggle-switch__input) {
  flex: none;
}

.charset-modal .modal-eyebrow {
  margin: 0 0 8px;
  color: var(--accent);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: .14em;
}

.charset-modal h2 {
  margin: 0;
  color: var(--ink);
  font-size: 20px;
  letter-spacing: -.03em;
}

.charset-modal-summary {
  margin: 8px 0 0;
  color: var(--ink-4);
  font-size: 12px;
}

.charset-modal-close {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-4);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.charset-modal-close:hover {
  background: var(--bg-soft);
  color: var(--ink-2);
}

.charset-modal-body {
  overflow: hidden;
  transition: height .22s ease;
}

.charset-modal-body-inner {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.charset-modal-status {
  display: grid;
  place-items: center;
  min-height: 280px;
  margin: 0;
}

.charset-char-grid {
  position: relative;
  flex: 1;
  max-height: min(60vh, 680px);
  overflow: hidden;
}

.charset-char-grid-scroll.fancy-scroll__viewport {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: 8px;
  align-content: start;
  box-sizing: border-box;
  height: auto;
  max-height: min(60vh, 680px);
  padding: 2px 14px 8px 2px;
}

.charset-char-card {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-white);
}

.charset-char-card.is-missing {
  background: var(--bg-soft);
}

.charset-char-glyph,
.charset-char-cp {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: center;
  cursor: pointer;
}

.charset-char-glyph {
  display: grid;
  place-items: center;
  min-height: 42px;
  color: var(--ink);
  font-size: 28px;
  line-height: 1;
}

.charset-char-glyph.is-fallback {
  color: var(--ink-5);
  font-family: "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif;
}

.charset-char-cp {
  color: var(--ink-5);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.charset-char-glyph:hover,
.charset-char-cp:hover {
  color: var(--accent-ink);
}

.charset-char-grid.is-loading {
  opacity: .55;
  pointer-events: none;
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
</style>
