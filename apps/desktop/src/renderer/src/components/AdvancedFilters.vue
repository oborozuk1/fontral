<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppButton from './AppButton.vue'
import AppInput from './AppInput.vue'
import SegmentedControl from './SegmentedControl.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import {
  formatFilterOptions,
  italicOptions,
  languageFilterOptions,
  variableOptions,
} from '../composables/useSettings'
import { useI18n } from '../composables/useI18n'
import type {
  FormatFilter,
  ItalicFilter,
  LanguageFilter,
  VariableFilter,
  WeightFilter,
} from '../composables/useFonts'

const weight = defineModel<WeightFilter>('weight', { required: true })
const italic = defineModel<ItalicFilter>('italic', { required: true })
const variable = defineModel<VariableFilter>('variable', { required: true })
const languages = defineModel<LanguageFilter>('languages', { required: true })
const tags = defineModel<string[]>('tags', { required: true })
const formats = defineModel<FormatFilter[]>('formats', { required: true })
const glyphCountMin = defineModel<number | null>('glyphCountMin', { required: true })
const glyphCountMax = defineModel<number | null>('glyphCountMax', { required: true })
const coversPreviewText = defineModel<boolean>('coversPreviewText', { required: true })

const props = defineProps<{
  availableTags: string[]
  commonTags: string[]
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  clear: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const tagDraft = ref('')
const panelStyle = ref<Record<string, string>>({})
const GLYPH_COUNT_MAX = 65_535
const WEIGHT_MIN = 100
const WEIGHT_MAX = 900
const { t } = useI18n()
const italics = computed(() => italicOptions(t))
const variables = computed(() => variableOptions(t))
const languageOptions = computed(() => languageFilterOptions(t))
const activeWeightThumb = ref<'start' | 'end'>('start')
const activeGlyphThumb = ref<'start' | 'end'>('start')

const weightStartSlider = computed({
  get: () => weight.value?.start ?? WEIGHT_MIN,
  set: (value: number) => {
    const end = weight.value?.end ?? WEIGHT_MAX
    weight.value = value === WEIGHT_MIN && end === WEIGHT_MAX ? null : { start: value, end }
  },
})
const weightEndSlider = computed({
  get: () => weight.value?.end ?? WEIGHT_MAX,
  set: (value: number) => {
    const start = weight.value?.start ?? WEIGHT_MIN
    weight.value = start === WEIGHT_MIN && value === WEIGHT_MAX ? null : { start, end: value }
  },
})
const weightRangeLabel = computed(() => {
  if (!weight.value) return t('ui.allWeights')
  const min = Math.min(weight.value.start, weight.value.end)
  const max = Math.max(weight.value.start, weight.value.end)
  return min === max ? String(min) : `${min} – ${max}`
})
const glyphMinSlider = computed({
  get: () => glyphCountMin.value ?? 0,
  set: (value: number) => { glyphCountMin.value = value || null },
})
const glyphMaxSlider = computed({
  get: () => glyphCountMax.value ?? GLYPH_COUNT_MAX,
  set: (value: number) => { glyphCountMax.value = value >= GLYPH_COUNT_MAX ? null : value },
})
const glyphRangeLabel = computed(() => {
  const min = Math.min(glyphCountMin.value ?? 0, glyphCountMax.value ?? GLYPH_COUNT_MAX)
  const max = Math.max(glyphCountMin.value ?? 0, glyphCountMax.value ?? GLYPH_COUNT_MAX)
  return `${min === 0 ? t('ui.any') : min.toLocaleString()} – ${max === GLYPH_COUNT_MAX ? t('ui.any') : max.toLocaleString()}`
})

const activeCount = computed(() => {
  let count = 0
  if (weight.value) count += 1
  if (italic.value) count += 1
  if (variable.value) count += 1
  if (languages.value.length) count += 1
  if (tags.value.length) count += 1
  if (formats.value.length) count += 1
  if (glyphCountMin.value !== null) count += 1
  if (glyphCountMax.value !== null) count += 1
  if (coversPreviewText.value) count += 1
  return count
})

const tagChoices = computed(() => {
  const selected = new Set(tags.value.map(tag => tag.toLowerCase()))
  const draft = tagDraft.value.trim().toLowerCase()
  const pool = [...new Set([...props.commonTags, ...props.availableTags])]
  return pool
    .filter(tag => !selected.has(tag.toLowerCase()))
    .filter(tag => !draft || tag.toLowerCase().includes(draft))
    .slice(0, 24)
})

function placePanel() {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const width = Math.min(520, window.innerWidth - 24)
  const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12)
  const top = Math.min(rect.bottom + 8, window.innerHeight - 24)
  panelStyle.value = {
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(240, window.innerHeight - top - 16)}px`,
  }
}

function toggleOpen() {
  emit('update:open', !props.open)
}

function closePanel() {
  emit('update:open', false)
}

function clearAll() {
  weight.value = null
  italic.value = ''
  variable.value = ''
  languages.value = []
  tags.value = []
  formats.value = []
  glyphCountMin.value = null
  glyphCountMax.value = null
  coversPreviewText.value = false
  tagDraft.value = ''
  emit('clear')
}

function toggleLanguage(language: LanguageFilter[number]) {
  languages.value = languages.value.includes(language)
    ? languages.value.filter(item => item !== language)
    : [...languages.value, language]
}

function toggleFormat(format: FormatFilter) {
  if (formats.value.includes(format)) {
    formats.value = formats.value.filter(item => item !== format)
  } else {
    formats.value = [...formats.value, format]
  }
}

function addTag(raw: string) {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 32)
  if (!name) return
  const key = name.toLowerCase()
  if (tags.value.some(tag => tag.toLowerCase() === key)) {
    tagDraft.value = ''
    return
  }
  tags.value = [...tags.value, name]
  tagDraft.value = ''
}

function removeTag(name: string) {
  tags.value = tags.value.filter(tag => tag !== name)
}

function onTagKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    addTag(tagDraft.value.replace(/,/g, ''))
  } else if (event.key === 'Backspace' && !tagDraft.value && tags.value.length) {
    removeTag(tags.value[tags.value.length - 1]!)
  }
}

function activateWeightThumb(thumb: 'start' | 'end') {
  activeWeightThumb.value = thumb
}

function activateGlyphThumb(thumb: 'start' | 'end') {
  activeGlyphThumb.value = thumb
}

function handlePointerdown(event: PointerEvent) {
  if (!props.open || !rootRef.value) return
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  if (path.includes(rootRef.value) || rootRef.value.contains(event.target as Node)) return
  closePanel()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    event.preventDefault()
    closePanel()
  }
}

function handleViewportChange() {
  if (props.open) placePanel()
}

onMounted(() => {
  window.addEventListener('pointerdown', handlePointerdown)
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handlePointerdown)
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})

watch(() => props.open, async value => {
  if (!value) return
  placePanel()
  await nextTick()
  placePanel()
  panelRef.value?.querySelector<HTMLElement>('button, input, select')?.focus()
})
</script>

<template>
  <div ref="rootRef" class="advanced-filters" @click.stop>
    <button
      ref="triggerRef"
      type="button"
      class="filter-trigger"
      :class="{ 'is-open': open, 'is-active': activeCount > 0 }"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-label="t('ui.advancedFilters')"
      @click="toggleOpen"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16M7 12h10M10 18h4" />
      </svg>
      <span>{{ t('ui.filters') }}</span>
      <Transition name="filter-badge" mode="out-in">
        <span v-if="activeCount" :key="activeCount" class="filter-badge">{{ activeCount }}</span>
      </Transition>
    </button>

    <Transition name="filter-panel">
      <div
        v-if="open"
        ref="panelRef"
        class="filter-panel fancy-scroll"
        role="dialog"
        :aria-label="t('ui.advancedFilters')"
        :style="panelStyle"
      >
        <div class="filter-panel-head">
          <strong>{{ t('ui.advancedFilters') }}</strong>
          <div class="filter-panel-actions">
            <button
              type="button"
              class="filter-text-btn"
              :disabled="!activeCount"
              @click="clearAll"
            >{{ t('ui.commonClear2') }}</button>
            <AppButton size="sm" variant="ghost" :label="t('ui.closeFilters')" :tooltip="t('ui.commonClose')" @click="closePanel">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </AppButton>
          </div>
        </div>

        <div class="filter-grid">
          <label class="filter-field filter-field--wide">
            <span class="filter-label filter-label--value"><span>{{ t('ui.weight') }}</span><strong>{{ weightRangeLabel }}</strong></span>
            <div class="dual-range-slider" :class="`dual-range-slider--active-${activeWeightThumb}`">
              <input class="dual-range-slider__start" v-model.number="weightStartSlider" type="range" :min="WEIGHT_MIN" :max="WEIGHT_MAX" step="100" :aria-label="t('ui.weightRangeStart')" @pointerdown="activateWeightThumb('start')" @focus="activateWeightThumb('start')" />
              <input class="dual-range-slider__end" v-model.number="weightEndSlider" type="range" :min="WEIGHT_MIN" :max="WEIGHT_MAX" step="100" :aria-label="t('ui.weightRangeEnd')" @pointerdown="activateWeightThumb('end')" @focus="activateWeightThumb('end')" />
            </div>
          </label>

          <div class="filter-field">
            <span class="filter-label">{{ t('ui.italic') }}</span>
            <SegmentedControl v-model="italic" :options="italics" :ariaLabel="t('ui.filterByItalic')" />
          </div>

          <div class="filter-field">
            <span class="filter-label">{{ t('ui.variableFonts') }}</span>
            <SegmentedControl v-model="variable" :options="variables" :ariaLabel="t('ui.filterByVariableFont')" />
          </div>

          <div class="filter-field filter-field--wide">
            <span class="filter-label">{{ t('ui.language') }}</span>
            <div class="chip-row" role="group" :aria-label="t('ui.filterByLanguage')">
              <button
                v-for="option in languageOptions"
                :key="option.value"
                type="button"
                class="filter-chip"
                :class="{ 'is-active': languages.includes(option.value) }"
                :aria-pressed="languages.includes(option.value)"
                @click="toggleLanguage(option.value)"
              >{{ option.label }}</button>
            </div>
          </div>

          <div class="filter-field filter-field--wide">
            <span class="filter-label filter-label--value"><span>{{ t('ui.characterCount') }}</span><strong>{{ glyphRangeLabel }}</strong></span>
            <div class="dual-range-slider" :class="`dual-range-slider--active-${activeGlyphThumb}`">
              <input class="dual-range-slider__start" v-model.number="glyphMinSlider" type="range" min="0" :max="GLYPH_COUNT_MAX" step="100" :aria-label="t('ui.characterCountRangeStart')" @pointerdown="activateGlyphThumb('start')" @focus="activateGlyphThumb('start')" />
              <input class="dual-range-slider__end" v-model.number="glyphMaxSlider" type="range" min="0" :max="GLYPH_COUNT_MAX" step="100" :aria-label="t('ui.characterCountRangeEnd')" @pointerdown="activateGlyphThumb('end')" @focus="activateGlyphThumb('end')" />
            </div>
          </div>

          <div class="filter-field filter-field--wide">
            <span class="filter-label">{{ t('ui.format') }}</span>
            <div class="chip-row" role="group" :aria-label="t('ui.fontFormat')">
              <button
                v-for="option in formatFilterOptions"
                :key="option.value"
                type="button"
                class="filter-chip"
                :class="{ 'is-active': formats.includes(option.value) }"
                @click="toggleFormat(option.value)"
              >{{ option.label }}</button>
            </div>
          </div>

          <div class="filter-field filter-field--wide">
            <span class="filter-label">{{ t('ui.tags') }}</span>
            <div class="tag-box">
              <TransitionGroup name="tag-chip">
                <span v-for="tag in tags" :key="tag" class="tag-chip">
                  {{ tag }}
                  <button type="button" class="tag-chip-remove" :aria-label="`${t('ui.removeTag')} ${tag}`" @click="removeTag(tag)">×</button>
                </span>
              </TransitionGroup>
              <AppInput
                v-model="tagDraft"
                class="tag-input"
                variant="plain"
                :maxlength="32"
                :placeholder="t('ui.typeATagAndPressEnter')"
                :aria-label="t('ui.filterTags')"
                @keydown="onTagKeydown"
              />
            </div>
            <Transition name="suggest-chip">
              <div v-if="tagChoices.length" class="chip-row chip-row--suggest">
                <button
                  v-for="tag in tagChoices"
                  :key="tag"
                  type="button"
                  class="filter-chip filter-chip--soft"
                  @click="addTag(tag)"
                >{{ tag }}</button>
              </div>
            </Transition>
          </div>

          <div class="filter-field filter-field--wide">
            <ToggleSwitch
              v-model="coversPreviewText"
              :label="t('ui.containsAllPreviewTextCharacters')"
              :description="t('ui.onlyShowFontsThatFullyRenderTheCurrentPreviewText')"
              :aria-label="t('ui.filterByPreviewTextCoverage')"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.advanced-filters {
  position: relative;
  flex: none;
}

.filter-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 40px;
  margin: 0;
  padding: 0 12px;
  border: 1px solid var(--search-border);
  border-radius: var(--radius);
  appearance: none;
  background: var(--select-bg);
  color: var(--ink-3);
  font-family: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color var(--ease), box-shadow var(--ease), color var(--ease), background var(--ease);
}

.filter-trigger svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.filter-trigger:hover,
.filter-trigger:focus-visible,
.filter-trigger.is-open,
.filter-trigger.is-active {
  border-color: var(--accent);
  color: var(--accent-ink);
  outline: 0;
}

.filter-trigger:focus-visible {
  box-shadow: var(--focus-ring);
}

.filter-trigger.is-active,
.filter-trigger.is-open {
  background: var(--accent-soft);
}

.filter-badge {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--accent);
  color: var(--bg-white);
  font-size: 11px;
  line-height: 1;
}

.filter-badge-enter-active,
.filter-badge-leave-active {
  transition: opacity .16s ease, transform .16s ease;
}

.filter-badge-enter-from,
.filter-badge-leave-to {
  opacity: 0;
  transform: scale(.65);
}

.filter-panel {
  position: fixed;
  z-index: 80;
  padding: 14px;
  overflow: auto;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  background: var(--select-menu-bg);
  box-shadow: var(--shadow-md);
  color: var(--ink);
  transform-origin: top right;
  scrollbar-width: thin;
}

.filter-panel-enter-active,
.filter-panel-leave-active {
  transition: opacity .16s var(--ease), transform .16s var(--ease);
}

.filter-panel-enter-from,
.filter-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(.98);
}

.filter-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.filter-panel-head strong {
  font-size: 13px;
  font-weight: 600;
}

.filter-panel-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.filter-text-btn {
  height: 28px;
  margin: 0;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  appearance: none;
  background: transparent;
  color: var(--ink-5);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.filter-text-btn:hover:not(:disabled),
.filter-text-btn:focus-visible:not(:disabled) {
  background: var(--select-hover);
  color: var(--accent-ink);
  outline: 0;
}

.filter-text-btn:disabled {
  opacity: .4;
  cursor: default;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 14px;
}

.filter-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.filter-field--wide {
  grid-column: 1 / -1;
}

.filter-label {
  color: var(--ink-5);
  font-size: 11px;
  line-height: 1.3;
}

.filter-label--value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.filter-label--value strong {
  color: var(--ink-3);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.filter-field :deep(.segmented-control) {
  display: grid;
  width: 100%;
  height: 34px;
}

.filter-field :deep(.segmented-control__option) {
  min-width: 0;
  padding: 0 6px;
  font-size: 11px;
}

.dual-range-slider input {
  width: 100%;
  height: 18px;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.dual-range-slider input::-webkit-slider-runnable-track {
  height: 5px;
  border-radius: 99px;
  background: var(--slider-track);
}

.dual-range-slider input::-webkit-slider-thumb {
  width: 15px;
  height: 15px;
  margin-top: -5px;
  border: 2px solid var(--bg-soft);
  border-radius: 50%;
  appearance: none;
  background: var(--accent);
  box-shadow: var(--shadow-thumb);
  transition: transform var(--ease), box-shadow var(--ease);
}

.dual-range-slider input:hover::-webkit-slider-thumb,
.dual-range-slider input:active::-webkit-slider-thumb {
  transform: scale(var(--slider-thumb-hover-scale));
  box-shadow: var(--shadow-thumb-active);
}

.dual-range-slider input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 99px;
}

.dual-range-slider {
  display: grid;
  position: relative;
  padding: 2px 0;
}

.dual-range-slider::before {
  content: '';
  grid-area: 1 / 1;
  align-self: center;
  height: 5px;
  border-radius: 99px;
  background: var(--slider-track);
}

.dual-range-slider input {
  grid-area: 1 / 1;
  pointer-events: none;
}

.dual-range-slider input::-webkit-slider-runnable-track {
  background: transparent;
}

.dual-range-slider__start {
  z-index: 2;
}

.dual-range-slider__end {
  z-index: 1;
}

.dual-range-slider--active-start .dual-range-slider__start,
.dual-range-slider--active-end .dual-range-slider__end {
  z-index: 3;
}

.dual-range-slider input:focus-visible,
.dual-range-slider input:active {
  z-index: 3;
}

.dual-range-slider input::-webkit-slider-thumb {
  pointer-events: auto;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip-row--suggest {
  margin-top: 8px;
}

.filter-chip {
  height: 28px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid var(--line-2);
  border-radius: 99px;
  appearance: none;
  background: var(--bg-white);
  color: var(--ink-3);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background var(--ease), border-color var(--ease), color var(--ease);
}

.filter-chip:hover,
.filter-chip:focus-visible {
  border-color: var(--accent);
  color: var(--accent-ink);
  outline: 0;
}

.filter-chip.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.filter-chip--soft {
  background: transparent;
}

.tag-box {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-height: 38px;
  padding: 5px 8px;
  border: 1px solid var(--search-border);
  border-radius: var(--radius);
  background: var(--select-bg);
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: 24px;
  padding: 0 4px 0 8px;
  border-radius: 99px;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 12px;
}

.tag-chip-remove {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  appearance: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--ease), color var(--ease);
}

.tag-chip-remove:hover,
.tag-chip-remove:focus-visible {
  background: var(--tag-remove-bg, rgb(0 0 0 / .08));
  outline: 0;
}

.tag-input {
  flex: 1;
  min-width: 120px;
}

.tag-input :deep(.app-input__control),
.tag-input :deep(input) {
  min-height: 24px;
  padding: 0;
}

.tag-chip-enter-active,
.tag-chip-leave-active {
  transition: opacity .2s ease, transform .2s ease;
}

.tag-chip-enter-from {
  opacity: 0;
  transform: scale(.7);
}

.tag-chip-leave-to {
  opacity: 0;
  transform: scale(.7);
}

.tag-chip-leave-active {
  position: absolute;
}

.tag-chip-move {
  transition: transform .2s ease;
}

.suggest-chip-enter-active,
.suggest-chip-leave-active {
  transition: opacity .15s ease, transform .15s ease;
}

.suggest-chip-enter-from,
.suggest-chip-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.filter-field :deep(.toggle-switch) {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  background: var(--bg-white);
}

@media (max-width: 640px) {
  .filter-grid {
    grid-template-columns: 1fr;
  }
}
</style>
