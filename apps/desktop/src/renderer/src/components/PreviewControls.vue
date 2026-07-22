<script setup lang="ts">
import { computed, watch } from 'vue'
import AppButton from './AppButton.vue'
import AppInput from './AppInput.vue'
import CustomSelect from './CustomSelect.vue'
import RangeSlider from './RangeSlider.vue'
import {
  previewTextPresetOptions,
  usePreviewTextPresetModel,
} from '../composables/useSettings'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const previewTextOptions = computed(() => previewTextPresetOptions(t))

const previewText = defineModel<string>('previewText', { required: true })
const pendingPreviewFontSize = defineModel<number>('pendingPreviewFontSize', { required: true })
const gridMinCol = defineModel<number>('gridMinCol', { required: true })

const props = defineProps<{
  viewMode: 'grid' | 'list'
  customPreviewText: string
  previewPreset: string
  previewPresetTexts: Record<string, string>
}>()

defineEmits<{
  'schedule-font-size': []
  'apply-font-size': []
  'toggle-view': []
}>()

const savedCustomPreviewText = computed(() => props.customPreviewText)
const savedPreviewPresetTexts = computed(() => props.previewPresetTexts)
const {
  selectedPreset: selectedPreviewTextPreset,
  inputRef: previewTextInput,
  onTextInput: onPreviewTextInput,
} = usePreviewTextPresetModel(previewText, {
  initialPreset: props.previewPreset,
  presetTexts: savedPreviewPresetTexts,
  savedCustomText: savedCustomPreviewText,
})

// A settings change resets the homepage session preview to the saved default.
watch(() => props.previewPreset, preset => {
  selectedPreviewTextPreset.value = preset
})
</script>

<template>
  <div class="preview-controls">
    <CustomSelect
      v-model="selectedPreviewTextPreset"
      class="preview-preset"
      :options="previewTextOptions"
      :ariaLabel="t('ui.previewTextPreset')"
    />
    <AppInput
      ref="previewTextInput"
      class="preview-input"
      :model-value="previewText"
      :maxlength="200"
      :placeholder="t('ui.enterPreviewText')"
      :aria-label="t('ui.previewText')"
      @update:model-value="onPreviewTextInput"
    />
    <RangeSlider
      v-model="pendingPreviewFontSize"
      class="preview-font-size"
      :label="t('ui.fontSize')"
      :aria-label="t('ui.previewFontSize')"
      :min="20"
      :max="160"
      :step="2"
      unit="px"
      @input="$emit('schedule-font-size')"
      @change="$emit('apply-font-size')"
    />
    <RangeSlider
      v-if="viewMode === 'grid'"
      v-model="gridMinCol"
      class="preview-grid-width"
      :label="t('ui.gridCardWidth')"
      :aria-label="t('ui.gridCardWidth')"
      :min="160"
      :max="420"
      :step="10"
      unit="px"
    />
    <div class="view-toggle">
      <AppButton
        :label="viewMode === 'grid' ? t('ui.gridView') : t('ui.listView')"
        :tooltip="viewMode === 'grid' ? t('ui.gridView') : t('ui.listView')"
        @click="$emit('toggle-view')"
      >
        <svg v-if="viewMode === 'grid'" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="6" height="6" />
          <rect x="14" y="4" width="6" height="6" />
          <rect x="4" y="14" width="6" height="6" />
          <rect x="14" y="14" width="6" height="6" />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 6h12M8 12h12M8 18h12" />
          <circle cx="4" cy="6" r="1" />
          <circle cx="4" cy="12" r="1" />
          <circle cx="4" cy="18" r="1" />
        </svg>
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.preview-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-preset {
  flex: 0 0 auto;
  width: 132px;
  margin-top: 12px;
}

.preview-input {
  flex: 1;
  width: auto;
  min-width: 0;
  margin-top: 12px;
}

.view-toggle {
  position: relative;
  z-index: 11;
  display: flex;
  justify-content: flex-end;
  margin: 12px 0 0 auto;
  pointer-events: none;
}

.view-toggle :deep(.app-button) {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  pointer-events: auto;
}

.view-toggle :deep(svg) {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

@media (max-width: 780px) {
  .preview-controls {
    display: block;
  }

  .preview-preset {
    width: 100%;
  }

  .preview-controls :deep(.preview-font-size) {
    justify-content: flex-end;
  }

  .view-toggle {
    margin: 4px 0 12px;
  }
}
</style>
