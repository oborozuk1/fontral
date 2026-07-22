<script setup lang="ts">
import { computed, onBeforeUpdate, onUpdated, ref, watch } from 'vue'
import type { FontFaceSummary } from '@fontral/contracts'
import type { FamilyNameMode } from '../composables/useSettings'
import { displayFamily } from '../composables/useFonts'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

const props = defineProps<{
  face: FontFaceSummary
  familyNameMode: FamilyNameMode
  previewText: string
  renderedText?: string
  previewFontFamily?: string
  previewUnavailable?: boolean
  previewFontSize: number
  viewMode: 'grid' | 'list'
  score?: number
  similarSourceFaceId?: number
  removable?: boolean
}>()

const emit = defineEmits<{
  open: [family: string]
  remove: [face: FontFaceSummary]
}>()

const family = computed(() => displayFamily(props.face, props.familyNameMode))
const preview = computed(() => props.renderedText ?? (props.previewText || family.value))
const previewLoaded = computed(() => Boolean(props.previewFontFamily))
const previewFailed = computed(() => !previewLoaded.value && props.previewUnavailable)
const previewLabel = computed(() => previewLoaded.value ? preview.value : previewFailed.value ? t('ui.previewUnavailable') : t('ui.commonLoading2'))
const cardRef = ref<HTMLElement | null>(null)
let previousRect: DOMRect | null = null
let layoutAnimation: Animation | null = null

watch(() => props.viewMode, () => {
  previousRect = cardRef.value?.getBoundingClientRect() ?? null
}, { flush: 'pre' })

onBeforeUpdate(() => {
  if (!previousRect) return
  layoutAnimation?.cancel()
})

onUpdated(() => {
  const card = cardRef.value
  const previous = previousRect
  previousRect = null
  if (!card || !previous) return
  const next = card.getBoundingClientRect()
  if (!next.width || (!Math.abs(previous.left - next.left) && !Math.abs(previous.top - next.top))) return
  layoutAnimation = card.animate([
    { transform: `translate(${previous.left - next.left}px, ${previous.top - next.top}px)` },
    { transform: 'translate(0, 0)' },
  ], { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' })
})

function openFamily() {
  emit('open', family.value)
}
</script>

<template>
  <article ref="cardRef" class="family-preview-card" :class="`family-preview-card--${viewMode}`" :data-similar-face-id="similarSourceFaceId ? face.id : undefined" :data-similar-source-face-id="similarSourceFaceId || undefined" role="button" tabindex="0" @click="openFamily" @keydown.enter="openFamily" @keydown.space.prevent="openFamily">
    <div class="family-preview-card__head">
      <span class="family-preview-card__name">{{ family }}</span>
      <span v-if="score !== undefined" class="family-preview-card__score">{{ score }}%</span>
      <button
        v-if="removable"
        type="button"
        class="family-preview-card__remove"
        :aria-label="t('ui.removeLink')"
        :data-tooltip="t('ui.removeLink')"
        @click.stop="emit('remove', face)"
      >×</button>
    </div>
    <div class="family-preview-card__preview-wrap" :style="{ minHeight: `${Math.ceil(previewFontSize * 1.35 + 8)}px` }">
      <Transition name="preview-reveal" mode="out-in">
        <span
          :key="previewLoaded ? 'ready' : previewFailed ? 'error' : 'loading'"
          type="button"
          class="family-preview-card__preview"
          :class="{ 'family-preview-card__preview--loading': !previewLoaded && !previewFailed, 'family-preview-card__preview--error': previewFailed }"
          :style="{ fontFamily: previewLoaded ? previewFontFamily : 'system-ui, sans-serif', fontSize: previewFailed ? '14px' : `${previewFontSize}px` }"
        >{{ previewLabel }}</span>
      </Transition>
    </div>
  </article>
</template>

<style scoped>
.family-preview-card {
  display: grid;
  min-width: 0;
  padding: 13px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-white);
  color: var(--ink-2);
  transition: border-color var(--ease);
}

.family-preview-card:hover { border-color: var(--accent); }

.family-preview-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.family-preview-card--list {
  position: relative;
  grid-template-columns: minmax(150px, .35fr) minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  padding-right: 46px;
}

.family-preview-card__head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.family-preview-card__name,
.family-preview-card__preview,
.family-preview-card__remove {
  margin: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.family-preview-card__name {
  overflow: hidden;
  min-width: 0;
  padding: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.family-preview-card__name:hover { color: var(--accent-ink); }

.family-preview-card__score {
  flex: none;
  margin-left: auto;
  color: var(--accent-ink);
  font-size: 16px;
}

.family-preview-card__remove {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 50%;
  color: var(--ink-5);
  font-size: 15px;
  line-height: 1;
  margin-left: auto;
}

.family-preview-card__remove:hover {
  background: var(--search-clear-bg);
  color: var(--ink-2);
}

.family-preview-card__preview {
  display: block;
  width: 100%;
  padding: 4px 0;
  overflow: hidden;
  font-synthesis: none;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.family-preview-card__preview-wrap {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  margin-top: 12px;
  overflow: hidden;
}

.family-preview-card__preview--loading {
  color: var(--face-muted);
  font-style: italic;
}

.family-preview-card__preview--error {
  color: var(--face-muted);
  line-height: 1;
}

.family-preview-card--list .family-preview-card__preview-wrap { margin-top: 0; }

.family-preview-card--list .family-preview-card__remove {
  position: absolute;
  top: 50%;
  right: 14px;
  transform: translateY(-50%);
}

.preview-reveal-enter-active,
.preview-reveal-leave-active {
  transition:
    opacity .2s ease,
    filter .2s ease,
    transform .2s cubic-bezier(.22, 1, .36, 1);
}

.preview-reveal-leave-active { position: absolute; }

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

@media (max-width: 620px) {
  .family-preview-card--list {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .family-preview-card--list .family-preview-card__preview-wrap { margin-top: 0; }
}
</style>
