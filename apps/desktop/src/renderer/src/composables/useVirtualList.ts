import { computed, onBeforeUnmount, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import { GRID_MIN_COL_DEFAULT } from './useSettings'

const GRID_GAP = 4
const LIST_GAP = 4
const OVERSCAN_ROWS = 4

function listRowHeight(previewFontSize: number) {
  return Math.ceil(17 * 2 + 10 + 40 + previewFontSize * 1.35 + 18 + 1)
}

function gridRowHeight(previewFontSize: number) {
  return Math.ceil(13 * 2 + 10 + 40 + previewFontSize * 1.35 + 12)
}

export function useVirtualList<T>(
  items: Ref<T[]> | ComputedRef<T[]>,
  options: {
    scrollRoot: Ref<HTMLElement | null> | ComputedRef<HTMLElement | null>
    viewMode: Ref<'grid' | 'list'> | ComputedRef<'grid' | 'list'>
    previewFontSize: Ref<number> | ComputedRef<number>
    gridMinCol?: Ref<number> | ComputedRef<number>
    /** Full result count for a paged source; preserves scroll extent before all pages load. */
    totalItems?: Ref<number> | ComputedRef<number>
    enabled?: Ref<boolean> | ComputedRef<boolean>
  },
) {
  const scrollTop = ref(0)
  const viewportHeight = ref(0)
  const viewportWidth = ref(0)
  const enabled = computed(() => options.enabled?.value !== false)

  let rootEl: HTMLElement | null = null
  let resizeObserver: ResizeObserver | undefined

  function measure() {
    const root = options.scrollRoot.value
    if (!root) return
    viewportHeight.value = root.clientHeight
    viewportWidth.value = root.clientWidth
    scrollTop.value = root.scrollTop
  }

  function onScroll() {
    const root = options.scrollRoot.value
    if (!root) return
    scrollTop.value = root.scrollTop
  }

  function bindRoot(root: HTMLElement | null) {
    if (rootEl) {
      rootEl.removeEventListener('scroll', onScroll)
      resizeObserver?.disconnect()
    }
    rootEl = root
    resizeObserver?.disconnect()
    if (!root) return
    root.addEventListener('scroll', onScroll, { passive: true })
    resizeObserver = new ResizeObserver(() => measure())
    resizeObserver.observe(root)
    measure()
  }

  watch(() => options.scrollRoot.value, bindRoot, { immediate: true })
  watch([
    () => options.viewMode.value,
    () => options.previewFontSize.value,
    () => options.gridMinCol?.value,
    () => items.value.length,
  ], () => {
    measure()
  })

  onBeforeUnmount(() => bindRoot(null))

  const columns = computed(() => {
    if (options.viewMode.value === 'list') return 1
    const width = Math.max(0, viewportWidth.value)
    if (width <= 0) return 1
    const minCol = Math.max(1, options.gridMinCol?.value ?? GRID_MIN_COL_DEFAULT)
    return Math.max(1, Math.floor((width + GRID_GAP) / (minCol + GRID_GAP)))
  })

  const rowHeight = computed(() => {
    const size = options.previewFontSize.value
    return options.viewMode.value === 'grid' ? gridRowHeight(size) : listRowHeight(size)
  })

  const rowGap = computed(() => (options.viewMode.value === 'grid' ? GRID_GAP : LIST_GAP))

  const rowStride = computed(() => rowHeight.value + rowGap.value)

  const totalRows = computed(() => {
    const count = Math.max(items.value.length, options.totalItems?.value ?? 0)
    if (!count) return 0
    return Math.ceil(count / columns.value)
  })

  const totalHeight = computed(() => {
    if (!enabled.value || !totalRows.value) return 0
    return totalRows.value * rowHeight.value + Math.max(0, totalRows.value - 1) * rowGap.value
  })

  const range = computed(() => {
    const count = Math.max(items.value.length, options.totalItems?.value ?? 0)
    if (!enabled.value || !count) {
      return { startRow: 0, endRow: 0, startIndex: 0, endIndex: 0, offsetY: 0 }
    }
    const stride = Math.max(1, rowStride.value)
    const rows = totalRows.value
    const startRow = Math.max(0, Math.floor(scrollTop.value / stride) - OVERSCAN_ROWS)
    const visibleRows = Math.ceil(viewportHeight.value / stride) + 1
    const endRow = Math.min(rows, startRow + visibleRows + OVERSCAN_ROWS * 2)
    const cols = columns.value
    const startIndex = startRow * cols
    const endIndex = Math.min(count, endRow * cols)
    const offsetY = startRow * stride
    return { startRow, endRow, startIndex, endIndex, offsetY }
  })

  const visibleItems = shallowRef<Array<{ item: T; index: number }>>([])

  watch(
    [items, range, enabled],
    () => {
      if (!enabled.value) {
        visibleItems.value = items.value.map((item, index) => ({ item, index }))
        return
      }
      const { startIndex, endIndex } = range.value
      const next: Array<{ item: T; index: number }> = []
      const list = items.value
      for (let index = startIndex; index < endIndex; index += 1) {
        const item = list[index]
        if (item !== undefined) next.push({ item, index })
      }
      visibleItems.value = next
    },
    { immediate: true },
  )

  const spacerStyle = computed(() => ({
    height: `${totalHeight.value}px`,
    position: 'relative' as const,
    width: '100%',
  }))

  const windowStyle = computed(() => ({
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    transform: `translateY(${range.value.offsetY}px)`,
    willChange: 'transform',
  }))

  const gridStyle = computed(() => {
    if (options.viewMode.value === 'grid') {
      return {
        display: 'grid',
        gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`,
        gap: `${GRID_GAP}px`,
      }
    }
    return {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: `${LIST_GAP}px`,
    }
  })

  return {
    visibleItems,
    spacerStyle,
    windowStyle,
    gridStyle,
    columns,
    rowHeight,
    totalHeight,
    totalRows,
    endIndex: computed(() => range.value.endIndex),
    measure,
  }
}
