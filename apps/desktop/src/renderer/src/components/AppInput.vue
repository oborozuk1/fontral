<script setup lang="ts">
import { computed, onMounted, ref, useAttrs, watch } from 'vue'
import AppButton from './AppButton.vue'
import FancyScrollbar from './FancyScrollbar.vue'
import { useI18n } from '../composables/useI18n'

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: '' })

const props = withDefaults(defineProps<{
  type?: 'text' | 'search' | 'password' | 'email' | 'url' | 'tel' | 'number'
  placeholder?: string
  maxlength?: number | string
  disabled?: boolean
  autofocus?: boolean
  spellcheck?: boolean | 'true' | 'false'
  clearable?: boolean
  clearLabel?: string
  clearTooltip?: string
  ariaLabel?: string
  id?: string
  name?: string
  autocomplete?: string
  multiline?: boolean
  rows?: number
  /** Fixed default and minimum height for a multiline field. */
  multilineHeight?: string
  variant?: 'field' | 'plain'
  resize?: 'none' | 'vertical' | 'horizontal' | 'both'
}>(), {
  type: 'text',
  disabled: false,
  autofocus: false,
  clearable: false,
  clearLabel: undefined,
  clearTooltip: undefined,
  multiline: false,
  rows: 4,
  variant: 'field',
  resize: 'vertical',
})

const emit = defineEmits<{
  clear: []
  enter: [event: KeyboardEvent]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
  keydown: [event: KeyboardEvent]
}>()

const attrs = useAttrs()
const { t } = useI18n()
const inputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const rootClass = computed(() => attrs.class)
const rootStyle = computed(() => attrs.style)
const multilineStyle = computed(() => props.multiline && props.multilineHeight
  ? { minHeight: props.multilineHeight }
  : undefined)
const textareaStyle = computed(() => props.multilineHeight
  ? { height: 'auto', minHeight: `calc(${props.multilineHeight} - 24px)` }
  : undefined)
const inputAttrs = computed(() => {
  const next = { ...attrs }
  delete next.class
  delete next.style
  return next
})

const showClear = computed(() => props.clearable && !!model.value && !props.disabled && !props.multiline)

function focus() {
  inputRef.value?.focus()
}

function select() {
  inputRef.value?.select()
}

function blur() {
  inputRef.value?.blur()
}

function clear() {
  model.value = ''
  emit('clear')
  focus()
}

function onKeydown(event: KeyboardEvent) {
  emit('keydown', event)
  if (event.key === 'Enter' && !props.multiline) emit('enter', event)
}

watch(() => props.autofocus, value => {
  if (value) void Promise.resolve().then(focus)
})

onMounted(() => {
  if (props.autofocus) focus()
})

defineExpose({
  focus,
  select,
  blur,
  get input() {
    return inputRef.value
  },
})
</script>

<template>
  <div
    class="app-input"
    :class="[
      `app-input--${variant}`,
      {
        'app-input--disabled': disabled,
        'app-input--clearable': clearable,
        'app-input--multiline': multiline,
      },
      rootClass,
    ]"
    :style="[rootStyle, multilineStyle]"
  >
    <span v-if="$slots.leading" class="app-input__leading">
      <slot name="leading" />
    </span>
    <textarea
      v-if="multiline"
      :id="id"
      ref="inputRef"
      v-model="model"
      class="app-input__control app-input__control--textarea"
      :class="`app-input__control--resize-${resize}`"
      :name="name"
      :rows="rows"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :disabled="disabled"
      :spellcheck="spellcheck"
       :aria-label="ariaLabel || placeholder"
       :style="textareaStyle"
      v-bind="inputAttrs"
      @focus="emit('focus', $event)"
      @blur="emit('blur', $event)"
      @keydown="onKeydown"
    />
    <FancyScrollbar v-if="multiline" :target="inputRef" :aria-label="ariaLabel" />
    <input
      v-else
      :id="id"
      ref="inputRef"
      v-model="model"
      class="app-input__control"
      :type="type"
      :name="name"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :disabled="disabled"
      :spellcheck="spellcheck"
      :autocomplete="autocomplete"
      :aria-label="ariaLabel || placeholder"
      v-bind="inputAttrs"
      @focus="emit('focus', $event)"
      @blur="emit('blur', $event)"
      @keydown="onKeydown"
    />
    <AppButton
      v-if="showClear"
      class="app-input__clear"
      variant="ghost"
      size="sm"
      :label="clearLabel ?? t('ui.commonClear')"
      :tooltip="clearTooltip ?? t('ui.commonClear')"
      @click="clear"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m7 7 10 10" />
        <path d="M17 7 7 17" />
      </svg>
    </AppButton>
    <span v-if="$slots.trailing" class="app-input__trailing">
      <slot name="trailing" />
    </span>
  </div>
</template>

<style scoped>
.app-input {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--search-border);
  border-radius: 9px;
  background-color: var(--bg-white);
  color: var(--search-icon);
  transition: border-color var(--ease), box-shadow var(--ease);
}

.app-input--field:hover,
.app-input--field:focus-within {
  border-color: var(--accent);
}

.app-input--field:focus-within {
  box-shadow: var(--focus-ring);
}

.app-input--plain {
  height: auto;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
}

.app-input--plain:hover,
.app-input--plain:focus-within {
  border-color: transparent;
  box-shadow: none;
}

.app-input--multiline {
  position: relative;
  align-items: stretch;
  height: auto;
  min-height: 150px;
  padding: 11px 12px;
}

.app-input--disabled {
  opacity: .55;
  cursor: default;
}

.app-input--field.app-input--disabled:hover,
.app-input--field.app-input--disabled:focus-within {
  border-color: var(--search-border);
  box-shadow: none;
}

.app-input__leading,
.app-input__trailing {
  display: grid;
  place-items: center;
  flex: none;
  color: inherit;
}

.app-input__leading :deep(svg),
.app-input__trailing :deep(svg) {
  display: block;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.app-input__control {
  width: 100%;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: 13px;
  user-select: text;
}

.app-input__control--textarea {
  display: block;
  min-height: 128px;
  line-height: 1.5;
}

.app-input__control--textarea {
  padding-right: 10px;
  scrollbar-width: none;
}

.app-input__control--textarea::-webkit-scrollbar { display: none; }

.app-input__control--resize-none { resize: none; }
.app-input__control--resize-vertical { resize: vertical; }
.app-input__control--resize-horizontal { resize: horizontal; }
.app-input__control--resize-both { resize: both; }

.app-input__control::placeholder {
  color: var(--ink-5);
}

.app-input__control:disabled {
  cursor: default;
}

.app-input__clear {
  width: 22px;
  height: 22px;
  margin-right: -4px;
  border: 0;
  border-radius: 50%;
  color: var(--search-clear);
}

.app-input__clear:hover:not(:disabled),
.app-input__clear:focus-visible:not(:disabled) {
  border-color: transparent;
  background: var(--search-clear-bg);
  color: var(--ink-3);
}

.app-input__clear :deep(svg) {
  width: 14px;
  height: 14px;
}
</style>
