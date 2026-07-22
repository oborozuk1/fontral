import type { App, Directive } from 'vue'

const GAP = 8
const EDGE = 8
const SHOW_DELAY = 120
const HIDE_DELAY = 60
const HIDE_ANIM_MS = 120

type Placement = 'top' | 'bottom' | 'left' | 'right'

let tipEl: HTMLDivElement | null = null
let activeEl: HTMLElement | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let hideAnimTimer: ReturnType<typeof setTimeout> | null = null
let attrObserver: MutationObserver | null = null
let overlayObserver: MutationObserver | null = null
let bound = false
let lastX = 0
let lastY = 0
let hiding = false

function ensureTip() {
  if (tipEl) return tipEl
  tipEl = document.createElement('div')
  tipEl.className = 'app-tooltip'
  tipEl.setAttribute('role', 'tooltip')
  tipEl.hidden = true
  tipEl.addEventListener('transitionend', onTipTransitionEnd)
  document.body.appendChild(tipEl)
  return tipEl
}

function clearTimers() {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (hideAnimTimer) {
    clearTimeout(hideAnimTimer)
    hideAnimTimer = null
  }
}

function finishHide() {
  if (!tipEl) return
  hiding = false
  if (hideAnimTimer) {
    clearTimeout(hideAnimTimer)
    hideAnimTimer = null
  }
  tipEl.hidden = true
  tipEl.classList.remove('is-visible', 'is-disabled')
  tipEl.textContent = ''
}

function onTipTransitionEnd(event: TransitionEvent) {
  if (event.target !== tipEl || event.propertyName !== 'opacity' || !hiding) return
  finishHide()
}

function cancelHideAnimation() {
  if (!hiding) return
  hiding = false
  if (hideAnimTimer) {
    clearTimeout(hideAnimTimer)
    hideAnimTimer = null
  }
}

function stopWatching() {
  attrObserver?.disconnect()
  attrObserver = null
}

function tooltipText(el: Element | null): string {
  if (!(el instanceof HTMLElement)) return ''
  return el.getAttribute('data-tooltip')?.trim() ?? ''
}

function isDisabled(el: HTMLElement) {
  if (
    el instanceof HTMLButtonElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLOptionElement ||
    el instanceof HTMLOptGroupElement ||
    el instanceof HTMLFieldSetElement
  ) {
    if (el.disabled) return true
  }
  if (el.getAttribute('aria-disabled') === 'true') return true
  if (el.hasAttribute('disabled')) return true
  return el.matches(':disabled')
}

function watchActive(el: HTMLElement) {
  stopWatching()
  attrObserver = new MutationObserver(() => {
    if (activeEl !== el) return
    const text = tooltipText(el)
    if (!text) {
      hideTip()
      return
    }
    placeTip(el, text)
  })
  attrObserver.observe(el, {
    attributes: true,
    attributeFilter: ['data-tooltip', 'disabled', 'aria-disabled']
  })
}

function hideTip(immediate = false) {
  clearTimers()
  stopWatching()
  activeEl = null
  if (!tipEl) return
  if (immediate || tipEl.hidden || !tipEl.classList.contains('is-visible')) {
    finishHide()
    return
  }
  hiding = true
  tipEl.classList.remove('is-visible')
  hideAnimTimer = setTimeout(finishHide, HIDE_ANIM_MS)
}

function preferredPlacement(el: HTMLElement): Placement {
  const attr = el.getAttribute('data-tooltip-placement')
  if (attr === 'top' || attr === 'bottom' || attr === 'left' || attr === 'right') return attr
  return 'top'
}

/** Usable viewport inset, treating the app titlebar as a forbidden band. */
function safeBounds() {
  let top = EDGE
  let bottom = window.innerHeight - EDGE
  let left = EDGE
  let right = window.innerWidth - EDGE

  const titlebar = document.querySelector('.titlebar')
  if (titlebar instanceof HTMLElement) {
    const tb = titlebar.getBoundingClientRect()
    if (tb.height > 0) top = Math.max(top, tb.bottom)
  }

  return { top, bottom, left, right }
}

function placeTip(el: HTMLElement, text: string) {
  const tip = ensureTip()
  cancelHideAnimation()
  tip.textContent = text
  tip.hidden = false
  tip.classList.toggle('is-disabled', isDisabled(el))
  tip.style.left = '0px'
  tip.style.top = '0px'

  const bounds = safeBounds()
  const maxW = Math.max(0, bounds.right - bounds.left)
  tip.style.maxWidth = `${Math.min(360, maxW)}px`

  const rect = el.getBoundingClientRect()
  const tipRect = tip.getBoundingClientRect()
  let placement = preferredPlacement(el)

  const space = {
    top: rect.top - bounds.top,
    bottom: bounds.bottom - rect.bottom,
    left: rect.left - bounds.left,
    right: bounds.right - rect.right
  }

  const fits = {
    top: space.top >= tipRect.height + GAP,
    bottom: space.bottom >= tipRect.height + GAP,
    left: space.left >= tipRect.width + GAP,
    right: space.right >= tipRect.width + GAP
  }

  if (!fits[placement]) {
    const order: Placement[] =
      placement === 'bottom' || placement === 'top'
        ? ['top', 'bottom', 'right', 'left']
        : ['right', 'left', 'bottom', 'top']
    placement = order.find(p => fits[p]) ?? (space.bottom >= space.top ? 'bottom' : 'top')
  }

  let left = 0
  let top = 0

  if (placement === 'top' || placement === 'bottom') {
    left = rect.left + rect.width / 2 - tipRect.width / 2
    top = placement === 'top' ? rect.top - tipRect.height - GAP : rect.bottom + GAP
  } else {
    top = rect.top + rect.height / 2 - tipRect.height / 2
    left = placement === 'left' ? rect.left - tipRect.width - GAP : rect.right + GAP
  }

  left = Math.min(Math.max(bounds.left, left), bounds.right - tipRect.width)
  top = Math.min(Math.max(bounds.top, top), bounds.bottom - tipRect.height)

  tip.style.left = `${Math.round(left)}px`
  tip.style.top = `${Math.round(top)}px`
  tip.dataset.placement = placement
  tip.classList.add('is-visible')
}

function isBlockingOverlay(node: Element) {
  return (
    node instanceof HTMLElement &&
    (node.classList.contains('modal-backdrop') || node.classList.contains('app-dialog-backdrop') || node.classList.contains('app-context-menu'))
  )
}

function isObscuredByOverlay(el: HTMLElement) {
  const backdrops = document.querySelectorAll('.modal-backdrop, .app-dialog-backdrop')
  if (backdrops.length) {
    const top = backdrops[backdrops.length - 1]!
    if (!top.contains(el)) return true
  }
  const menu = document.querySelector('.app-context-menu')
  return Boolean(menu && !menu.contains(el))
}

function findTargetAtPoint(x: number, y: number): HTMLElement | null {
  let lockedTo: Element | null = null
  for (const node of document.elementsFromPoint(x, y)) {
    if (!(node instanceof Element) || node === tipEl) continue
    // Once an overlay is hit, only accept tooltip targets inside it.
    if (isBlockingOverlay(node)) {
      lockedTo = node
      continue
    }
    if (lockedTo && !lockedTo.contains(node)) continue
    if (node instanceof HTMLElement && tooltipText(node)) {
      return isObscuredByOverlay(node) ? null : node
    }
    const el = node.closest('[data-tooltip]')
    if (el instanceof HTMLElement && tooltipText(el)) {
      if (lockedTo && !lockedTo.contains(el)) continue
      return isObscuredByOverlay(el) ? null : el
    }
  }
  return null
}

function scheduleShow(el: HTMLElement) {
  if (isObscuredByOverlay(el)) {
    if (activeEl) scheduleHide()
    return
  }
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (activeEl === el) {
    if (showTimer) return
    if (tipEl && (!tipEl.hidden || hiding)) {
      placeTip(el, tooltipText(el))
      return
    }
  }
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  activeEl = el
  watchActive(el)
  showTimer = setTimeout(() => {
    showTimer = null
    if (activeEl !== el) return
    if (isObscuredByOverlay(el)) {
      hideTip()
      return
    }
    const text = tooltipText(el)
    if (!text) {
      hideTip()
      return
    }
    placeTip(el, text)
  }, SHOW_DELAY)
}

function scheduleHide() {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  if (hideTimer) return
  hideTimer = setTimeout(hideTip, HIDE_DELAY)
}

function updateFromPoint(x: number, y: number) {
  lastX = x
  lastY = y
  const el = findTargetAtPoint(x, y)
  if (el) {
    scheduleShow(el)
    return
  }
  if (activeEl) scheduleHide()
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  updateFromPoint(event.clientX, event.clientY)
}

function onPointerLeaveDocument() {
  if (activeEl) scheduleHide()
}

function onFocusIn(event: FocusEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const el = target instanceof HTMLElement && tooltipText(target) ? target : target.closest('[data-tooltip]')
  if (!(el instanceof HTMLElement) || !tooltipText(el) || isObscuredByOverlay(el)) return
  scheduleShow(el)
}

function onFocusOut(event: FocusEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const el = target instanceof HTMLElement && tooltipText(target) ? target : target.closest('[data-tooltip]')
  if (!(el instanceof HTMLElement) || activeEl !== el) return
  // Defer to pointer position if mouse is still over the control.
  requestAnimationFrame(() => updateFromPoint(lastX, lastY))
}

function onScrollOrResize() {
  if (!activeEl) return
  const el = findTargetAtPoint(lastX, lastY)
  if (!el) {
    hideTip()
    return
  }
  if (el !== activeEl) {
    scheduleShow(el)
    return
  }
  const text = tooltipText(activeEl)
  if (!text || !document.contains(activeEl)) {
    hideTip()
    return
  }
  placeTip(activeEl, text)
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') hideTip(true)
}

function nodeTouchesOverlay(node: Node) {
  if (!(node instanceof Element)) return false
  if (isBlockingOverlay(node)) return true
  return Boolean(node.querySelector?.('.modal-backdrop, .app-dialog-backdrop, .app-context-menu'))
}

function onOverlayChange(mutations: MutationRecord[]) {
  if (!activeEl) return
  let touched = false
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (nodeTouchesOverlay(node)) {
        touched = true
        break
      }
    }
    if (touched) break
    for (const node of mutation.removedNodes) {
      if (nodeTouchesOverlay(node)) {
        touched = true
        break
      }
    }
    if (touched) break
  }
  if (!touched) return
  if (isObscuredByOverlay(activeEl)) hideTip(true)
}

function bindGlobal() {
  if (bound || typeof window === 'undefined') return
  bound = true
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerleave', onPointerLeaveDocument, true)
  document.documentElement.addEventListener('mouseleave', onPointerLeaveDocument)
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)
  document.addEventListener('keydown', onKeyDown, true)
  overlayObserver = new MutationObserver(onOverlayChange)
  overlayObserver.observe(document.body, { childList: true, subtree: true })
}

const tooltipDirective: Directive = {
  mounted() {
    bindGlobal()
  }
}

export function setupTooltips(app: App) {
  bindGlobal()
  app.directive('tooltip', tooltipDirective)
}

export function teardownTooltips() {
  clearTimers()
  hideTip(true)
  overlayObserver?.disconnect()
  overlayObserver = null
  if (!bound) return
  bound = false
  document.removeEventListener('pointermove', onPointerMove, true)
  document.removeEventListener('pointerleave', onPointerLeaveDocument, true)
  document.documentElement.removeEventListener('mouseleave', onPointerLeaveDocument)
  document.removeEventListener('focusin', onFocusIn, true)
  document.removeEventListener('focusout', onFocusOut, true)
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
  document.removeEventListener('keydown', onKeyDown, true)
  tipEl?.removeEventListener('transitionend', onTipTransitionEnd)
  tipEl?.remove()
  tipEl = null
  hiding = false
}
