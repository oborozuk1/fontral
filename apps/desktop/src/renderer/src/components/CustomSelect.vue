<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FancyScrollbar from './FancyScrollbar.vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

type SelectValue = string | number | null

const props = defineProps<{
  modelValue: SelectValue
  options: ReadonlyArray<{ label: string; value: SelectValue }>
  ariaLabel: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: SelectValue] }>()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)
const focusedIndex = ref(-1)
const scrollable = ref(false)
const menuDirection = ref<'up' | 'down'>('down')
const menuStyle = ref<Record<string, string>>({})
const selectedOption = computed(() => props.options.find(option => option.value === props.modelValue) ?? props.options[0])

async function syncScrollable() {
  await nextTick()
  const el = menu.value
  scrollable.value = !!el && el.scrollHeight > el.clientHeight + 1
}

function openMenu() {
  focusedIndex.value = Math.max(0, props.options.findIndex(option => option.value === props.modelValue))
  open.value = true
  void syncScrollable()
  void placeMenu()
}

function closeMenu(restoreFocus = false) {
  open.value = false
  focusedIndex.value = -1
  scrollable.value = false
  menuDirection.value = 'down'
  menuStyle.value = {}
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}

function scrollParentFor(element: HTMLElement) {
  let parent = element.parentElement
  while (parent) {
    const overflowY = getComputedStyle(parent).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent
    parent = parent.parentElement
  }
  return null
}

async function placeMenu(allowScroll = true) {
  await nextTick()
  const triggerEl = trigger.value
  const menuEl = menu.value
  if (!triggerEl || !menuEl || !open.value) return

  const triggerRect = triggerEl.getBoundingClientRect()
  const desiredHeight = Math.min(menuEl.scrollHeight, 240)
  const spaceBelow = window.innerHeight - triggerRect.bottom - 8
  const spaceAbove = triggerRect.top - 8

  if (allowScroll && spaceBelow < desiredHeight && spaceBelow >= spaceAbove) {
    const scrollParent = scrollParentFor(triggerEl)
    if (scrollParent) {
      const scrollRect = scrollParent.getBoundingClientRect()
      const overflow = triggerRect.bottom + 8 + desiredHeight - scrollRect.bottom
      if (overflow > 0) {
        scrollParent.scrollTop += overflow
        await nextTick()
        return placeMenu(false)
      }
    }
  }

  const opensUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow
  const availableHeight = opensUp ? spaceAbove : spaceBelow
  menuDirection.value = opensUp ? 'up' : 'down'
  menuStyle.value = { maxHeight: `${Math.max(80, Math.min(240, availableHeight))}px` }
  await syncScrollable()
}

function clearHover() {
  focusedIndex.value = -1
}

function toggleMenu(event?: Event) {
  event?.stopPropagation()
  event?.preventDefault()
  if (open.value) closeMenu()
  else openMenu()
}

function choose(option: { label: string; value: SelectValue }, event?: Event) {
  event?.stopPropagation()
  event?.preventDefault()
  emit('update:modelValue', option.value)
  closeMenu(true)
}

function handleKeydown(event: KeyboardEvent) {
  if (!open.value && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault()
    openMenu()
    return
  }
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (focusedIndex.value < 0) {
      focusedIndex.value = event.key === 'ArrowDown' ? 0 : props.options.length - 1
      return
    }
    const direction = event.key === 'ArrowDown' ? 1 : -1
    focusedIndex.value = (focusedIndex.value + direction + props.options.length) % props.options.length
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    focusedIndex.value = event.key === 'Home' ? 0 : props.options.length - 1
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const option = props.options[focusedIndex.value]
    if (option) choose(option)
  }
}

function handleFocusout(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) closeMenu()
}

function handlePointerdown(event: PointerEvent) {
  if (!open.value || !root.value) return
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  if (path.includes(root.value) || root.value.contains(event.target as Node)) return
  closeMenu()
}

watch(open, async value => {
  if (!value) return
  await nextTick()
  menu.value?.focus({ preventScroll: true })
  void placeMenu()
})

function handleViewportChange() {
  if (open.value) void placeMenu(false)
}

onMounted(() => {
  window.addEventListener('pointerdown', handlePointerdown)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handlePointerdown)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})
</script>

<template>
  <div ref="root" class="custom-select" @keydown="handleKeydown" @focusout="handleFocusout" @click.stop>
    <button ref="trigger" type="button" class="custom-select-trigger" :aria-label="ariaLabel" aria-haspopup="listbox"
      :aria-expanded="open" @click="toggleMenu">
      <span>{{ selectedOption?.label }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
    </button>
    <Transition name="custom-select-menu">
      <div v-if="open" class="custom-select-menu fancy-scroll" :class="`custom-select-menu--${menuDirection}`" :style="menuStyle">
        <div ref="menu" class="custom-select-options fancy-scroll__viewport" :class="{ 'is-scrollable': scrollable }" :style="menuStyle"
          role="listbox" :aria-label="ariaLabel" tabindex="-1" @mouseleave="clearHover">
          <button v-for="(option, index) in options" :key="String(option.value)" type="button" role="option"
            :aria-selected="option.value === modelValue" :class="{ selected: option.value === modelValue, focused: index === focusedIndex }"
            @mouseenter="focusedIndex = index" @pointerdown.stop.prevent="choose(option, $event)">{{ option.label }}</button>
        </div>
        <FancyScrollbar :target="menu" :aria-label="`${ariaLabel} ${t('ui.scrollbar')}`" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.custom-select {
  position: relative;
  flex: none;
  min-width: 112px;
}

.custom-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 40px;
  padding: 0 10px;
  border: 1px solid var(--search-border);
  border-radius: var(--radius);
  appearance: none;
  background-color: var(--select-bg);
  color: var(--ink-3);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--ease), box-shadow var(--ease), color var(--ease);
}

.custom-select-trigger:hover,
.custom-select-trigger:focus-visible {
  border-color: var(--accent);
  color: var(--ink);
  outline: 0;
}

.custom-select-trigger:focus-visible {
  box-shadow: var(--focus-ring);
}

.custom-select-trigger svg {
  width: 16px;
  height: 16px;
  margin-left: 8px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.custom-select-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 5px);
  left: 0;
  width: 100%;
  max-height: 240px;
  overflow: hidden;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  background-color: var(--select-menu-bg);
  box-shadow: var(--shadow-md);
  color: var(--ink);
  transform-origin: top center;
}

.custom-select-menu--up {
  top: auto;
  bottom: calc(100% + 5px);
  transform-origin: bottom center;
}

.custom-select-menu-enter-active,
.custom-select-menu-leave-active {
  transition: opacity var(--ease), transform var(--ease);
}

.custom-select-menu-enter-from,
.custom-select-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(.96);
}

.custom-select-menu-enter-to,
.custom-select-menu-leave-from {
  opacity: 1;
  transform: none;
}

.custom-select-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  padding: 4px;
}

.custom-select-options.is-scrollable {
  padding-right: 14px;
}

.custom-select-options button {
  display: block;
  width: 100%;
  padding: 6px 9px;
  border: 0;
  border-radius: 5px;
  appearance: none;
  background: transparent;
  color: var(--select-option-ink);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background var(--ease), color var(--ease);
}

.custom-select-options button:hover,
.custom-select-options button.focused {
  background: var(--select-hover);
  color: var(--accent-ink);
}

.custom-select-options button.selected {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.custom-select-options button.selected:hover,
.custom-select-options button.selected.focused {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

@media (max-width: 780px) {
  .custom-select { flex: 1; }
}
</style>
