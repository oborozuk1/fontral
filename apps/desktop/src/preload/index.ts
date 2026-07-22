import { contextBridge, ipcRenderer } from 'electron'
import type { FontralApi } from '@fontral/contracts'

const api: FontralApi = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    openExternal: url => ipcRenderer.invoke('app:open-external', url),
  },
  fonts: {
    query: input => ipcRenderer.invoke('fonts:query', input),
    family: (family, filter) => ipcRenderer.invoke('fonts:family', family, filter),
    similar: (faceId, mode) => ipcRenderer.invoke('fonts:similar', faceId, mode),
    details: id => ipcRenderer.invoke('fonts:details', id),
    charsetChars: input => ipcRenderer.invoke('fonts:charset-chars', input),
    previewText: (faceId, text) => ipcRenderer.invoke('fonts:preview-text', faceId, text),
    updateUserData: input => ipcRenderer.invoke('fonts:update-user-data', input),
    updateFamilyNote: (faceId, note) => ipcRenderer.invoke('fonts:update-family-note', faceId, note),
    updateFamilyLanguage: (faceId, language) => ipcRenderer.invoke('fonts:update-family-language', faceId, language),
    listFamilyLinks: faceId => ipcRenderer.invoke('fonts:list-family-links', faceId),
    addFamilyLink: (faceId, targetFaceId) => ipcRenderer.invoke('fonts:add-family-link', faceId, targetFaceId),
    removeFamilyLink: (faceId, targetFaceId) => ipcRenderer.invoke('fonts:remove-family-link', faceId, targetFaceId),
    listTags: () => ipcRenderer.invoke('fonts:list-tags'),
    updateFamilyTags: (faceId, tags) => ipcRenderer.invoke('fonts:update-family-tags', faceId, Array.from(tags ?? [], tag => String(tag))),
    openFile: faceId => ipcRenderer.invoke('fonts:open-file', faceId),
    revealInFolder: faceId => ipcRenderer.invoke('fonts:reveal-in-folder', faceId),
    clearPreviewCache: () => ipcRenderer.invoke('fonts:clear-preview-cache'),
  },
  library: {
    addRoot: () => ipcRenderer.invoke('library:add-root'),
    rescan: (rootId, path) => ipcRenderer.invoke('library:rescan', rootId, path),
    rebuildDatabase: () => ipcRenderer.invoke('library:rebuild-database'),
    removeRoot: rootId => ipcRenderer.invoke('library:remove-root', rootId),
    listRoots: () => ipcRenderer.invoke('library:list-roots'),
    updateRootNote: (rootId, note) => ipcRenderer.invoke('library:update-root-note', rootId, note),
    updateFolderNote: (rootId, path, note) => ipcRenderer.invoke('library:update-folder-note', rootId, path, note),
    updateRootVisible: (rootId, visible) => ipcRenderer.invoke('library:update-root-visible', rootId, visible),
    updateFolderVisible: (rootId, path, visible) => ipcRenderer.invoke('library:update-folder-visible', rootId, path, visible),
    openFolder: path => ipcRenderer.invoke('library:open-folder', path),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    confirmClose: action => ipcRenderer.invoke('window:confirm-close', action),
    setMinimizeToTray: enabled => ipcRenderer.invoke('window:set-minimize-to-tray', enabled),
    reloadApp: () => ipcRenderer.invoke('window:reload-app'),
  },
  activation: {
    activate: faceId => ipcRenderer.invoke('activation:activate', faceId),
    deactivate: faceId => ipcRenderer.invoke('activation:deactivate', faceId),
    list: () => ipcRenderer.invoke('activation:list'),
  }
}
contextBridge.exposeInMainWorld('fontral', api)
ipcRenderer.on('library:changed', () => window.dispatchEvent(new Event('library:changed')))
ipcRenderer.on('fonts:index-changed', () => window.dispatchEvent(new Event('fonts:index-changed')))
ipcRenderer.on('activation:status', (_event, detail) => window.dispatchEvent(new CustomEvent('activation:status', { detail })))
ipcRenderer.on('window:close-requested', () => window.dispatchEvent(new Event('window:close-requested')))
