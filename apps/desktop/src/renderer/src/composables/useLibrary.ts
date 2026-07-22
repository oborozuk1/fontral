import { ref } from 'vue'
import type { LibraryFolderNode, LibraryRootTree } from '@fontral/contracts'
import { useI18n } from './useI18n'

export type Root = LibraryRootTree
export type FolderNode = LibraryFolderNode

export type FolderSelection = {
  rootId: number
  path: string
} | null

export type FolderTarget = {
  rootId: number
  path: string
  note: string
  isRoot: boolean
}

export function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function scanPercent(root: Root) {
  return root.scanProgress?.total ? Math.round((root.scanProgress.processed / root.scanProgress.total) * 100) : 0
}

export function sameFolderSelection(a: FolderSelection, b: FolderSelection) {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.rootId === b.rootId && a.path === b.path
}

function findFolderNote(root: Root, path: string): string {
  if (path === root.path) return root.note
  const stack = [...root.children]
  while (stack.length) {
    const node = stack.pop()!
    if (node.path === path) return node.note
    stack.push(...node.children)
  }
  return ''
}

function folderDescendants(nodes: FolderNode[]) {
  const result: FolderNode[] = []
  const walk = (children: FolderNode[]) => {
    for (const node of children) {
      result.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return result
}

export function useLibrary(api: typeof window.fontral, onError: (message: string) => void, onScanFinished?: () => void) {
  const { t } = useI18n()
  const roots = ref<Root[]>([])
  const rootToRemove = ref<Root | null>(null)
  const folderToEditNote = ref<FolderTarget | null>(null)
  const rootNote = ref('')
  const selectedFolder = ref<FolderSelection>(null)
  const expandedPaths = ref(new Set<string>())

  function pruneExpanded(nextRoots: Root[]) {
    const valid = new Set<string>()
    const walk = (nodes: FolderNode[]) => {
      for (const node of nodes) {
        valid.add(node.path)
        if (node.children.length) walk(node.children)
      }
    }
    for (const root of nextRoots) {
      valid.add(root.path)
      walk(root.children)
    }
    const next = new Set<string>()
    for (const path of expandedPaths.value) {
      if (valid.has(path)) next.add(path)
    }
    expandedPaths.value = next
  }

  function pruneSelection(nextRoots: Root[]) {
    if (!selectedFolder.value) return
    const current = selectedFolder.value
    const root = nextRoots.find(item => item.id === current.rootId)
    if (!root) {
      selectedFolder.value = null
      return
    }
    if (current.path === root.path) return
    const stack = [...root.children]
    while (stack.length) {
      const node = stack.pop()!
      if (node.path === current.path) return
      stack.push(...node.children)
    }
    selectedFolder.value = { rootId: root.id, path: root.path }
  }

  async function refreshRoots() {
    try {
      const wasScanning = roots.value.some(root => root.scanStatus === 'scanning')
      roots.value = await api.library.listRoots()
      pruneExpanded(roots.value)
      pruneSelection(roots.value)
      if (wasScanning && !roots.value.some(root => root.scanStatus === 'scanning')) onScanFinished?.()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('ui.couldNotReadFontFolders'))
    }
  }

  async function addRoot() {
    try {
      const rootId = await api.library.addRoot()
      if (rootId !== null) await refreshRoots()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('ui.couldNotOpenFolderPicker'))
    }
  }

  async function rescanFolder(rootId: number, path?: string) {
    await api.library.rescan(rootId, path)
  }

  async function toggleRootVisibility(root: Root, onToggled?: () => void | Promise<void>) {
    try {
      const visible = !Boolean(root.visible)
      const children = folderDescendants(root.children)
      await Promise.all([
        api.library.updateRootVisible(root.id, visible),
        ...children.map(node => api.library.updateFolderVisible(root.id, node.path, visible)),
      ])
      root.visible = Number(visible)
      for (const node of children) node.visible = Number(visible)
      await onToggled?.()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('ui.couldNotUpdateFolderVisibility'))
    }
  }

  function findFolderParent(root: Root, childPath: string): FolderNode | null {
    const walk = (nodes: FolderNode[]): FolderNode | null => {
      for (const node of nodes) {
        if (node.children.some(child => child.path === childPath)) return node
        const found = walk(node.children)
        if (found) return found
      }
      return null
    }
    return walk(root.children)
  }

  async function toggleFolderVisibility(rootId: number, node: FolderNode, onToggled?: () => void | Promise<void>) {
    try {
      const visible = !Boolean(node.visible)
      const children = folderDescendants(node.children)
      await Promise.all([
        api.library.updateFolderVisible(rootId, node.path, visible),
        ...children.map(child => api.library.updateFolderVisible(rootId, child.path, visible)),
      ])
      for (const child of [node, ...children]) child.visible = Number(visible)
      await cascadeVisibilityUp(rootId, node.path)
      await onToggled?.()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('ui.couldNotUpdateFolderVisibility'))
    }
  }

  async function cascadeVisibilityUp(rootId: number, startPath: string) {
    const root = roots.value.find(item => item.id === rootId)
    if (!root) return
    let currentPath = startPath
    while (true) {
      const parent = findFolderParent(root, currentPath)
      const anyChildVisible = parent
        ? parent.children.some(child => child.visible === 1)
        : root.children.some(child => child.visible === 1)
      const target = anyChildVisible ? 1 : 0
      if (parent) {
        if (parent.visible !== target) {
          await api.library.updateFolderVisible(rootId, parent.path, Boolean(target))
          parent.visible = target
        }
        currentPath = parent.path
      } else {
        if (root.visible !== target) {
          await api.library.updateRootVisible(rootId, Boolean(target))
          root.visible = target
        }
        break
      }
    }
  }

  function removeRoot(root: Root) {
    rootToRemove.value = root
  }

  async function confirmRemoveRoot(onRemoved?: () => void | Promise<void>) {
    if (!rootToRemove.value) return
    try {
      await api.library.removeRoot(rootToRemove.value.id)
      rootToRemove.value = null
      await onRemoved?.()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('ui.couldNotRemoveFontFolder'))
    }
  }

  function resolveFolderTarget(rootId: number, path: string): FolderTarget | null {
    const root = roots.value.find(item => item.id === rootId)
    if (!root) return null
    return {
      rootId,
      path,
      note: findFolderNote(root, path),
      isRoot: path === root.path,
    }
  }

  function editFolderNote(rootId: number, path: string) {
    const target = resolveFolderTarget(rootId, path)
    if (!target) return
    folderToEditNote.value = target
    rootNote.value = target.note || folderName(target.path)
  }

  async function saveFolderNote() {
    if (!folderToEditNote.value) return
    try {
      const { rootId, path, isRoot } = folderToEditNote.value
      if (isRoot) await api.library.updateRootNote(rootId, rootNote.value)
      else await api.library.updateFolderNote(rootId, path, rootNote.value)
      folderToEditNote.value = null
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('ui.couldNotSaveFolderNote'))
    }
  }

  function isExpanded(path: string) {
    return expandedPaths.value.has(path)
  }

  function toggleExpanded(path: string) {
    const next = new Set(expandedPaths.value)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    expandedPaths.value = next
  }

  function expandAncestors(rootId: number, path: string) {
    const root = roots.value.find(item => item.id === rootId)
    if (!root || path === root.path) return
    const ancestors: string[] = []
    const walk = (nodes: FolderNode[], trail: string[]): boolean => {
      for (const node of nodes) {
        if (node.path === path) {
          ancestors.push(...trail)
          return true
        }
        if (node.children.length && walk(node.children, [...trail, node.path])) return true
      }
      return false
    }
    if (!walk(root.children, [root.path])) return
    let changed = false
    const next = new Set(expandedPaths.value)
    for (const ancestor of ancestors) {
      if (!next.has(ancestor)) {
        next.add(ancestor)
        changed = true
      }
    }
    if (changed) expandedPaths.value = next
  }

  function selectFolder(rootId: number, path: string) {
    const next = { rootId, path }
    if (sameFolderSelection(selectedFolder.value, next)) {
      selectedFolder.value = null
      return
    }
    selectedFolder.value = next
    expandAncestors(rootId, path)
  }

  function clearFolderSelection() {
    selectedFolder.value = null
  }

  return {
    roots,
    rootToRemove,
    folderToEditNote,
    rootNote,
    selectedFolder,
    expandedPaths,
    refreshRoots,
    addRoot,
    rescanFolder,
    toggleRootVisibility,
    toggleFolderVisibility,
    removeRoot,
    confirmRemoveRoot,
    editFolderNote,
    saveFolderNote,
    isExpanded,
    toggleExpanded,
    selectFolder,
    clearFolderSelection,
  }
}
