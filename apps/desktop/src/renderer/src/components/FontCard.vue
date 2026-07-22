<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import type { FontFaceSummary } from '@fontral/contracts'
import type { FamilyNameMode } from '../composables/useSettings'
import { displayFamily, displaySubfamily } from '../composables/useFonts'
import AppButton from './AppButton.vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

const props = defineProps<{
  face: FontFaceSummary
  mode: 'home' | 'family'
  loaded: boolean
  previewError?: string
  previewText: string
  previewFontSize: number
  renderedText?: string
  copiedFamily: number | null
  copiedName?: string | null
  active: boolean
  activating: boolean
  familyFallback?: string | null
  familyNameMode: FamilyNameMode
  copyNameValue?: string | null
  showOpenFamilyButton?: boolean
}>()

const emit = defineEmits<{
  observe: [element: unknown, face: FontFaceSummary]
  leave: [face: FontFaceSummary]
  'copy-family': [face: FontFaceSummary]
  'copy-name': [face: FontFaceSummary]
  'open-family': [family: string]
  activate: [face: FontFaceSummary]
  favorite: [face: FontFaceSummary]
}>()

onBeforeUnmount(() => emit('leave', props.face))

const nameCopied = computed(() => Boolean(props.copyNameValue && props.copiedName === props.copyNameValue))

const familyLabel = computed(() => displayFamily(props.face, props.familyNameMode))
const subfamilyLabel = computed(() => displaySubfamily(props.face, props.familyNameMode))

/** Prefer last good preview text so expand/reload does not flash "Loading...". */
const previewLabel = computed(() => {
  if (props.previewError) return t('ui.previewUnavailable')
  const readyText = props.renderedText ?? (props.previewText || props.familyFallback || familyLabel.value)
  if (props.loaded) return readyText
  if (props.renderedText) return props.renderedText
  return t('ui.commonLoading2')
})

const previewStyle = computed(() => ({
  fontFamily: props.loaded || props.renderedText ? `fontral_${props.face.id}` : 'system-ui',
  fontSize: `${props.previewFontSize}px`,
}))

const showInitialLoading = computed(() => !props.loaded && !props.previewError && !props.renderedText)
/** Only animate the first loading → ready reveal; expand keeps the same node to avoid flicker. */
const previewTransitionKey = computed(() => {
  if (props.previewError) return 'error'
  if (showInitialLoading.value) return 'loading'
  return 'ready'
})
</script>

<template>
  <article class="face" :ref="el => { if (el) emit('observe', el, face) }" :data-face-id="face.id">
    <div v-if="mode === 'home'">
      <button
        class="family-link"
        type="button"
        :data-tooltip="nameCopied ? t('ui.copied') : t('ui.copyFontName')"
        @click="emit('copy-family', face)"
      >
        {{ familyLabel }}
      </button>
      <span>{{ subfamilyLabel }} · {{ face.format?.toUpperCase() }}</span>
    </div>
    <div v-else>
      <strong>{{ subfamilyLabel }}</strong>
      <span>
        {{ face.format?.toUpperCase() }}
        <template v-if="face.isVariable"> · {{ t('ui.variableFonts') }}</template>
      </span>
    </div>
    <div class="face-actions">
      <AppButton
        v-if="mode === 'home' && showOpenFamilyButton !== false"
        :label="t('ui.viewFontFamily')"
        :tooltip="t('ui.viewFontFamily')"
        @click="emit('open-family', familyLabel)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 0-4 0V4Z" />
          <path d="M9 8h6M9 12h6" />
        </svg>
      </AppButton>
      <AppButton
        v-if="mode === 'family'"
        :label="nameCopied ? t('ui.copied') : t('ui.copyFontName')"
        :tooltip="nameCopied ? t('ui.copied') : t('ui.copyFontName')"
        @click="emit('copy-name', face)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="8" width="11" height="11" rx="1" />
          <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
        </svg>
      </AppButton>
      <AppButton
        class="activate-button"
        :active="active"
        :busy="activating"
        :label="activating ? t('ui.updatingFontActivation') : active ? t('ui.deactivateFont') : t('ui.activateFont')"
        :tooltip="active ? t('ui.deactivateFont') : t('ui.activateFont')"
        @click="emit('activate', face)"
      >
        <svg v-if="!activating" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4v8" />
          <path d="M7.05 7.05a7 7 0 1 0 9.9 0" />
        </svg>
        <svg v-else class="activation-spinner" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
        </svg>
      </AppButton>
      <AppButton
        class="favorite-button"
        :active="face.favorite"
        :label="face.favorite ? t('ui.removeFromFavorites') : t('ui.favorites')"
        :tooltip="face.favorite ? t('ui.removeFromFavorites') : t('ui.favorites')"
        @click="emit('favorite', face)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m12 5.2 2.2 4.46 4.92.72-3.56 3.47.84 4.9L12 16.47 7.6 18.75l.84-4.9-3.56-3.47 4.92-.72L12 5.2Z" />
        </svg>
      </AppButton>
    </div>
    <div class="face-preview-wrap">
      <Transition name="preview-reveal">
        <p
          :key="previewTransitionKey"
          class="face-preview"
          :class="{
            'face-preview--loading': showInitialLoading,
            'face-preview--error': previewError,
            'face-preview--pending': !loaded && !previewError && Boolean(renderedText),
          }"
          :data-tooltip="previewError || undefined"
          :role="mode === 'home' ? 'button' : undefined"
          :tabindex="mode === 'home' ? 0 : undefined"
          :style="previewStyle"
          @click="mode === 'home' && emit('open-family', familyLabel)"
          @keydown.enter="mode === 'home' && emit('open-family', familyLabel)"
        >
          {{ previewLabel }}
        </p>
      </Transition>
    </div>
  </article>
</template>

<style scoped>
.face {
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: 10px;
  column-gap: 20px;
  padding: 17px 4px;
  border-bottom: 1px solid var(--line-3);
  overflow: hidden;
}

.face strong {
  display: block;
  font-size: 14px;
}

.face span {
  display: block;
  margin-top: 4px;
  color: var(--face-meta);
  font-size: 11px;
}

.family-link {
  display: block;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  text-align: left;
}

.family-link:hover,
.family-link:focus-visible {
  color: var(--accent-ink);
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}

.face-preview-wrap {
  position: relative;
  grid-column: 1 / -1;
  min-height: calc(1.35em + 16px);
  margin: 2px 0 0;
  overflow: hidden;
}

.face-preview {
  margin: 0;
  padding: 8px 0;
  overflow: hidden;
  color: inherit;
  font-size: 30px;
  font-synthesis: none;
  line-height: 1.35;
  text-overflow: ellipsis;
  text-rendering: optimizeLegibility;
  white-space: nowrap;
  -webkit-font-smoothing: antialiased;
}

.face-preview[role='button'] {
  cursor: pointer;
}

.face-preview--loading {
  color: var(--face-muted);
  font-style: italic;
  font-family: system-ui, sans-serif !important;
}

.face-preview--pending {
  opacity: 0.72;
  transition: opacity var(--ease);
}

.face-preview--error {
  color: var(--face-muted);
  font-family: system-ui, sans-serif !important;
  font-size: 14px !important;
}

.preview-reveal-enter-active,
.preview-reveal-leave-active {
  transition:
    opacity 0.2s ease,
    filter 0.2s ease,
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.preview-reveal-leave-active {
  position: absolute;
  inset: 0;
}

.preview-reveal-leave-to {
  opacity: 0;
  filter: blur(2px);
  transform: translateY(-4px);
}

.preview-reveal-enter-from {
  opacity: 0;
  filter: blur(2px);
  transform: translateY(4px);
}

.face-preview:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

.face-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.face-actions :deep(.app-button svg) {
  width: 18px;
  height: 18px;
  stroke-width: 1.8;
}

.face-actions :deep(.favorite-button svg) {
  width: 20px;
  height: 20px;
  stroke-width: 1.7;
}

.face-actions :deep(.favorite-button.is-active svg) {
  fill: currentColor;
}

.face-actions :deep(.activation-spinner) {
  stroke-dasharray: 26 18;
  animation: activation-spin .8s linear infinite;
}

@keyframes activation-spin {
  to {
    transform: rotate(360deg);
    transform-origin: center;
  }
}

@media (max-width: 780px) {
  .face-preview {
    font-size: 24px;
  }
}
</style>
