<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  target?: HTMLElement | null
  observe?: ReadonlyArray<HTMLElement | null | undefined>
  ariaLabel?: string
  minThumb?: number
  fixed?: boolean
}>(), {
  target: null,
  observe: () => [],
  ariaLabel: undefined,
  minThumb: 48,
  fixed: false,
})

const track = ref<HTMLElement | null>(null)
const scroll = ref({ top: 0, height: 0, client: 0 })
const dragging = ref(false)
let pointerOffset = 0
let resizeObserver: ResizeObserver | undefined
let mutationObserver: MutationObserver | undefined
let boundTarget: HTMLElement | null = null
let boundObserveKey = ''

const visible = computed(() => scroll.value.height > scroll.value.client + 1)

function metrics(client: number, height: number, trackHeight: number) {
  const maxScroll = Math.max(0, height - client)
  const ratio = height > 0 ? client / height : 1
  const thumbHeight = Math.min(trackHeight, Math.max(props.minThumb, Math.round(trackHeight * ratio)))
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  return { maxScroll, thumbHeight, maxThumbTop }
}

const thumbStyle = computed(() => {
  const { top, height, client } = scroll.value
  const trackHeight = Math.max(0, client)
  const { maxScroll, thumbHeight, maxThumbTop } = metrics(client, height, trackHeight)
  const thumbTop = maxScroll > 0 ? (top / maxScroll) * maxThumbTop : 0
  return {
    height: `${thumbHeight}px`,
    transform: `translateY(${thumbTop}px)`,
  }
})

const trackStyle = computed(() => {
  if (props.fixed) return undefined
  const client = scroll.value.client
  return client > 0 ? { height: `${client}px`, bottom: 'auto' } : undefined
})

function observeKey() {
  return [props.target, ...(props.observe ?? [])].map(item => item ? 1 : 0).join('')
}

let syncFrame = 0

function readScroll() {
  const element = props.target
  if (!element) {
    scroll.value = { top: 0, height: 0, client: 0 }
    return
  }
  scroll.value = {
    top: element.scrollTop,
    height: element.scrollHeight,
    client: element.clientHeight,
  }
}

function sync() {
  readScroll()
  // CSSOM height updates (virtual list spacers) can lag one frame behind Vue's nextTick.
  if (syncFrame) cancelAnimationFrame(syncFrame)
  syncFrame = requestAnimationFrame(() => {
    syncFrame = 0
    readScroll()
  })
}

function scrollToPosition(clientY: number, offset = 0) {
  const element = props.target
  const trackElement = track.value
  if (!element || !trackElement) return

  const rect = trackElement.getBoundingClientRect()
  const trackHeight = rect.height
  const { maxScroll, maxThumbTop } = metrics(element.clientHeight, element.scrollHeight, trackHeight)
  if (maxScroll <= 0 || maxThumbTop <= 0) {
    element.scrollTop = 0
    return
  }

  const rawTop = clientY - rect.top - offset
  const nextThumbTop = Math.max(0, Math.min(maxThumbTop, rawTop))
  // Snap to ends so drag/click always reaches exact bounds.
  if (nextThumbTop <= 0.5) {
    element.scrollTop = 0
    return
  }
  if (nextThumbTop >= maxThumbTop - 0.5) {
    element.scrollTop = maxScroll
    return
  }
  element.scrollTop = (nextThumbTop / maxThumbTop) * maxScroll
}

function handlePointerDown(event: PointerEvent) {
  const trackElement = track.value
  if (!trackElement) return
  const thumb = (event.target as Element).closest('.fancy-scrollbar-thumb') as HTMLElement | null
  if (thumb) {
    pointerOffset = event.clientY - thumb.getBoundingClientRect().top
  } else {
    const thumbHeight = Number.parseFloat(thumbStyle.value.height) || props.minThumb
    pointerOffset = thumbHeight / 2
  }
  dragging.value = true
  trackElement.setPointerCapture(event.pointerId)
  scrollToPosition(event.clientY, pointerOffset)
}

function handlePointerMove(event: PointerEvent) {
  if (dragging.value) scrollToPosition(event.clientY, pointerOffset)
}

function handlePointerUp(event: PointerEvent) {
  dragging.value = false
  track.value?.releasePointerCapture(event.pointerId)
}

function unbind() {
  boundTarget?.removeEventListener('scroll', readScroll)
  boundTarget = null
  boundObserveKey = ''
  if (syncFrame) cancelAnimationFrame(syncFrame)
  syncFrame = 0
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  resizeObserver = undefined
  mutationObserver = undefined
}

function bind(force = false) {
  const element = props.target ?? null
  const key = observeKey()
  if (!force && element === boundTarget && key === boundObserveKey) {
    sync()
    return
  }
  unbind()
  boundObserveKey = key
  if (!element) {
    sync()
    return
  }
  boundTarget = element
  element.addEventListener('scroll', readScroll, { passive: true })
  resizeObserver = new ResizeObserver(() => readScroll())
  const observeSizes = () => {
    resizeObserver?.disconnect()
    resizeObserver?.observe(element)
    for (const item of props.observe ?? []) if (item) resizeObserver?.observe(item)
    // Virtual lists change extent via child box size; observe descendants with layout.
    for (const child of element.children) resizeObserver?.observe(child)
  }
  observeSizes()
  let mutationFrame = 0
  let needsResizeRebind = false
  mutationObserver = new MutationObserver(records => {
    if (records.some(record => record.type === 'childList')) needsResizeRebind = true
    if (mutationFrame) return
    mutationFrame = window.requestAnimationFrame(() => {
      mutationFrame = 0
      if (needsResizeRebind) {
        needsResizeRebind = false
        observeSizes()
      }
      readScroll()
    })
  })
  mutationObserver.observe(element, {
    childList: true,
    subtree: true,
    characterData: false,
    attributes: true,
    attributeFilter: ['style', 'class'],
  })
  readScroll()
}

watch(() => [props.target, ...(props.observe ?? [])] as const, () => bind(), { immediate: true, flush: 'post' })
onBeforeUnmount(unbind)
defineExpose({ sync })
</script>

<template>
  <div
    v-show="visible"
    ref="track"
    class="fancy-scrollbar"
    :class="{ dragging, 'is-fixed': fixed }"
    :style="trackStyle"
    role="scrollbar"
    :aria-label="ariaLabel ?? t('ui.scrollbar')"
    :aria-valuemin="0"
    :aria-valuemax="Math.max(0, scroll.height - scroll.client)"
    :aria-valuenow="Math.round(scroll.top)"
    @pointerdown.prevent="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerUp"
  >
    <i class="fancy-scrollbar-thumb" :style="thumbStyle"></i>
  </div>
</template>

<style scoped>
.fancy-scrollbar {
  position: absolute;
  z-index: 5;
  top: 0;
  right: 0;
  bottom: 0;
  width: 14px;
  overflow: hidden;
  cursor: pointer;
  touch-action: none;
}

.fancy-scrollbar.is-fixed {
  position: fixed;
  z-index: 100;
  top: 42px;
  bottom: 0;
  height: auto !important;
}

.fancy-scrollbar-thumb {
  display: block;
  width: 6px;
  min-height: 40px;
  margin: 0 4px;
  border-radius: 999px;
  background: var(--dark-muted);
  opacity: .55;
  transition: background-color .15s, opacity .15s;
  pointer-events: auto;
}

.fancy-scrollbar:hover .fancy-scrollbar-thumb,
.fancy-scrollbar.dragging .fancy-scrollbar-thumb {
  background-color: var(--accent);
  opacity: 1;
}
</style>
