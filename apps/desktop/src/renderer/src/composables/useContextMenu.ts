import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from './useI18n'

export type ContextMenuAction =
  | 'copy'
  | 'paste'
  | 'open-folder'
  | 'edit-note'
  | 'edit-tags'
  | 'rescan'
  | 'remove-root'
  | 'view-charset'
  | 'copy-name'
  | 'add-family-link'

export type ContextMenuState = {
  x: number
  y: number
  actions: ContextMenuAction[]
  copyText: string
  target: HTMLInputElement | HTMLTextAreaElement | null
  faceId: number | null
  similarSourceFaceId: number | null
  rootId: number | null
  folderPath: string | null
  isRootFolder: boolean
  rescanDisabled: boolean
  charsetSource: 'unicode' | 'cjk' | null
  charsetKey: string | null
  charsetTitle: string | null
}

const MENU_WIDTH = 148
const MENU_ITEM_HEIGHT = 34
const MENU_PAD = 10

function isTextField(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true
  if (!(el instanceof HTMLInputElement)) return false
  const type = (el.type || 'text').toLowerCase()
  return !['button', 'checkbox', 'radio', 'range', 'file', 'submit', 'reset', 'image', 'color', 'hidden'].includes(type)
}

function isSelectable(el: HTMLElement) {
  const value = getComputedStyle(el).userSelect
  return value === 'text' || value === 'all'
}

function fieldCopyText(el: HTMLInputElement | HTMLTextAreaElement) {
  const start = el.selectionStart
  const end = el.selectionEnd
  if (start != null && end != null && start !== end) return el.value.slice(start, end)
  return el.value
}

function findContextTarget(start: EventTarget | null): {
  field: HTMLInputElement | HTMLTextAreaElement | null
  selectable: HTMLElement | null
} {
  let current = start instanceof Element ? start : null
  let field: HTMLInputElement | HTMLTextAreaElement | null = null
  let selectable: HTMLElement | null = null

  while (current instanceof HTMLElement && current !== document.body) {
    if (!field && isTextField(current)) field = current
    if (!selectable && isSelectable(current)) selectable = current
    current = current.parentElement
  }

  return { field, selectable }
}

function menuHeight(actionCount: number) {
  return MENU_PAD + actionCount * MENU_ITEM_HEIGHT
}

export function useContextMenu(
  onError: (message: string) => void,
  handlers?: {
    editNote?: (rootId: number, path: string) => void
    editTags?: () => void
    rescan?: (rootId: number, path: string) => void
    removeRoot?: (rootId: number) => void
    viewCharset?: (source: 'unicode' | 'cjk', key: string, title: string) => void
    similarFontAction?: (action: 'copy-name' | 'add-family-link', sourceFaceId: number, targetFaceId: number) => void | Promise<void>
  },
) {
  const { t } = useI18n()
  const contextMenu = ref<ContextMenuState | null>(null)

  function closeContextMenu() {
    contextMenu.value = null
  }

  function openContextMenu(event: MouseEvent) {
    if (!(event.target instanceof Node)) return
    if (event.target instanceof Element && event.target.closest('.app-context-menu')) return

    const selectedText = window.getSelection()?.toString() ?? ''
    const { field, selectable } = findContextTarget(event.target)
    const pathEl = event.target instanceof Element ? event.target.closest('.detail-path[data-face-id]') : null
    const faceIdRaw = pathEl instanceof HTMLElement ? Number(pathEl.dataset.faceId) : NaN
    const faceId = Number.isInteger(faceIdRaw) && faceIdRaw > 0 ? faceIdRaw : null
    const similarEl = event.target instanceof Element ? event.target.closest('[data-similar-face-id][data-similar-source-face-id]') : null
    const similarFaceIdRaw = similarEl instanceof HTMLElement ? Number(similarEl.dataset.similarFaceId) : NaN
    const similarSourceFaceIdRaw = similarEl instanceof HTMLElement ? Number(similarEl.dataset.similarSourceFaceId) : NaN
    const similarFaceId = Number.isInteger(similarFaceIdRaw) && similarFaceIdRaw > 0 ? similarFaceIdRaw : null
    const similarSourceFaceId = Number.isInteger(similarSourceFaceIdRaw) && similarSourceFaceIdRaw > 0 ? similarSourceFaceIdRaw : null

    const folderEl = event.target instanceof Element ? event.target.closest('[data-folder-path]') : null
    const folderPath = folderEl instanceof HTMLElement && folderEl.dataset.folderPath ? folderEl.dataset.folderPath : null
    const folderRootIdRaw = folderEl instanceof HTMLElement ? Number(folderEl.dataset.rootId) : NaN
    const folderRootId = Number.isInteger(folderRootIdRaw) && folderRootIdRaw > 0 ? folderRootIdRaw : null

    const rootEl = event.target instanceof Element ? event.target.closest('.root[data-root-id]') : null
    const rootIdRaw = rootEl instanceof HTMLElement ? Number(rootEl.dataset.rootId) : NaN
    const rootId = Number.isInteger(rootIdRaw) && rootIdRaw > 0 ? rootIdRaw : null
    const rootPath = rootEl instanceof HTMLElement ? rootEl.dataset.rootPath ?? null : null
    const resolvedRootId = folderRootId ?? rootId
    const resolvedPath = folderPath ?? rootPath
    const isRootFolder = Boolean(resolvedRootId && resolvedPath && rootPath && resolvedPath === rootPath)
    const rescanDisabled = rootEl instanceof HTMLElement && rootEl.dataset.scanStatus === 'scanning'
    const tagsEl = event.target instanceof Element ? event.target.closest('[data-note-tags]') : null
    const charsetEl = event.target instanceof Element ? event.target.closest('[data-charset-key]') : null
    const charsetSourceRaw = charsetEl instanceof HTMLElement ? charsetEl.dataset.charsetSource : null
    const charsetSource = charsetSourceRaw === 'unicode' || charsetSourceRaw === 'cjk' ? charsetSourceRaw : null
    const charsetKey = charsetEl instanceof HTMLElement ? charsetEl.dataset.charsetKey || null : null
    const charsetTitle = charsetEl instanceof HTMLElement ? charsetEl.dataset.charsetTitle || charsetKey : null

    let copyText = ''
    const actions: ContextMenuAction[] = []

    if (similarFaceId && similarSourceFaceId) {
      actions.push('copy-name', 'add-family-link')
    } else {
      if (charsetSource && charsetKey) {
        actions.push('view-charset')
      }

      if (resolvedRootId && resolvedPath) {
        actions.push('open-folder', 'edit-note', 'rescan')
        if (isRootFolder) actions.push('remove-root')
      } else if (faceId) {
        actions.push('open-folder')
      }

      if (tagsEl) actions.push('edit-tags')

      if (field) {
        copyText = fieldCopyText(field)
        if (copyText) actions.push('copy')
        if (!field.readOnly && !field.disabled) actions.push('paste')
      } else if (selectedText) {
        copyText = selectedText
        actions.push('copy')
      } else if (selectable || pathEl instanceof HTMLElement) {
        const source = selectable ?? (pathEl instanceof HTMLElement ? pathEl : null)
        copyText = (source?.innerText || source?.textContent || '').trim()
        if (copyText) actions.push('copy')
      }
    }

    event.preventDefault()
    event.stopPropagation()

    if (!actions.length) {
      closeContextMenu()
      return
    }

    const height = menuHeight(actions.length)
    contextMenu.value = {
      x: Math.min(event.clientX, window.innerWidth - MENU_WIDTH),
      y: Math.min(event.clientY, window.innerHeight - height),
      actions,
      copyText,
      target: field,
      faceId: similarFaceId ?? faceId,
      similarSourceFaceId,
      rootId: resolvedRootId,
      folderPath: resolvedPath,
      isRootFolder,
      rescanDisabled,
      charsetSource,
      charsetKey,
      charsetTitle,
    }
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value)
  }

  async function pasteInto(el: HTMLInputElement | HTMLTextAreaElement) {
    const text = await navigator.clipboard.readText()
    if (!text) return

    el.focus()
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const next = el.value.slice(0, start) + text + el.value.slice(end)
    const prototype = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    descriptor?.set?.call(el, next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    const caret = start + text.length
    el.setSelectionRange(caret, caret)
  }

  async function runContextAction(action: ContextMenuAction) {
    const menu = contextMenu.value
    if (!menu) return

    try {
      if (action === 'copy-name' || action === 'add-family-link') {
        if (!menu.similarSourceFaceId || !menu.faceId) return
        await handlers?.similarFontAction?.(action, menu.similarSourceFaceId, menu.faceId)
      } else if (action === 'copy') {
        if (!menu.copyText) return
        await copyText(menu.copyText)
      } else if (action === 'paste') {
        if (!menu.target) return
        await pasteInto(menu.target)
      } else if (action === 'open-folder') {
        if (menu.folderPath) await window.fontral.library.openFolder(menu.folderPath)
        else if (menu.faceId) await window.fontral.fonts.revealInFolder(menu.faceId)
      } else if (action === 'edit-note') {
        if (!menu.rootId || !menu.folderPath) return
        handlers?.editNote?.(menu.rootId, menu.folderPath)
      } else if (action === 'edit-tags') {
        handlers?.editTags?.()
      } else if (action === 'rescan') {
        if (!menu.rootId || !menu.folderPath || menu.rescanDisabled) return
        handlers?.rescan?.(menu.rootId, menu.folderPath)
      } else if (action === 'remove-root') {
        if (!menu.rootId || !menu.isRootFolder) return
        handlers?.removeRoot?.(menu.rootId)
      } else if (action === 'view-charset') {
        if (!menu.charsetSource || !menu.charsetKey) return
        handlers?.viewCharset?.(menu.charsetSource, menu.charsetKey, menu.charsetTitle || menu.charsetKey)
      }
    } catch (cause) {
      const fallback =
        action === 'paste' ? t('ui.couldNotPaste')
          : action === 'add-family-link' ? t('ui.couldNotSaveLink')
          : action === 'open-folder' ? t('ui.couldNotOpenFolder')
            : action === 'edit-note' ? t('ui.couldNotEditNote')
              : action === 'edit-tags' ? t('ui.couldNotOpenTagSettings')
                : action === 'rescan' ? t('ui.couldNotRescan')
                  : action === 'remove-root' ? t('ui.couldNotRemoveFolder')
                    : action === 'view-charset' ? t('ui.couldNotOpenCharacterSet')
                      : t('ui.couldNotCopy')
      onError(cause instanceof Error ? cause.message : fallback)
    } finally {
      closeContextMenu()
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeContextMenu()
  }

  function onScroll() {
    if (contextMenu.value) closeContextMenu()
  }

  onMounted(() => {
    window.addEventListener('contextmenu', openContextMenu, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', closeContextMenu)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('contextmenu', openContextMenu, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', closeContextMenu)
  })

  return {
    contextMenu,
    closeContextMenu,
    runContextAction,
  }
}
