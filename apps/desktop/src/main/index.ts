import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, session, shell, Tray } from 'electron'
import { join, normalize, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import * as fontkit from 'fontkit'
import { ActivationClient } from '@fontral/activation-client'
import { FontDatabase } from '@fontral/database'
import { scanRoot } from '@fontral/font-indexer'
import { charsetCharsQuerySchema, faceIdSchema, familyTagsSchema, folderFilterSchema, folderPathSchema, fontFamilySchema, fontLanguageSchema, fontQuerySchema, rootIdSchema, similarityModeSchema, userDataSchema, type SimilarityMode } from '@fontral/contracts'
import { computeCjkCoverage, countCjkCharacters, getCjkCharsetCodePoints, getCjkUnicodeBlockCodePoints, inferFontLanguage } from './cjk-coverage'
import { mapPreviewText, MISSING_GLYPH } from './cmap-coverage'
import { normalizePreviewText, PreviewSubsetService } from './preview-subset'

protocol.registerSchemesAsPrivileged([{ scheme: 'font-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
// LCD subpixel antialiasing creates colored fringes around large font previews.
app.commandLine.appendSwitch('disable-lcd-text')
let window: BrowserWindow | undefined
let database: FontDatabase
let tray: Tray | undefined
let minimizeToTray = false
let isQuitting = false
let quitCleanupComplete = false
let activationClient: ActivationClient
let previewSubsets: PreviewSubsetService
const scans = new Map<number, ReturnType<typeof scanRoot>>()
const scanProgress = new Map<number, { processed: number; total: number }>()
/** Bumped when a scan is cancelled so stale worker exit/message handlers no-op. */
const scanGenerations = new Map<number, number>()
let libraryUpdateTimer: ReturnType<typeof setTimeout> | undefined
let indexUpdateTimer: ReturnType<typeof setTimeout> | undefined
let similarityWorkerActive = false
let similarityWorkScheduled = false
let faceSimilarityRequested = false
let similarityPriorityFaceId: number | undefined
/** Throttle how often the renderer reloads the face list while a scan is writing rows. */
const INDEX_UPDATE_MS = 400
/** Glyph coverage / metadata only. Keep tiny: full fontkit objects for CJK faces are huge. */
const DETAIL_FONT_CACHE_MAX = 4
const detailFonts = new Map<number, { path: string; faceIndex: number; font: any }>()

function touchDetailFont(faceId: number, entry: { path: string; faceIndex: number; font: any }) {
  detailFonts.delete(faceId)
  detailFonts.set(faceId, entry)
  while (detailFonts.size > DETAIL_FONT_CACHE_MAX) {
    const oldest = detailFonts.keys().next().value as number | undefined
    if (oldest === undefined) break
    detailFonts.delete(oldest)
  }
}

function getDetailFont(faceId: number) {
  const source = database.previewPath(faceId)
  if (!source) throw new Error('找不到该字体文件。')
  let cached = detailFonts.get(faceId)
  if (!cached || cached.path !== source.path || cached.faceIndex !== source.faceIndex) {
    const collection: any = fontkit.create(readFileSync(source.path))
    const font = 'fonts' in collection ? collection.fonts[source.faceIndex] : collection
    if (!font) throw new Error('找不到该字体字形。')
    cached = { path: source.path, faceIndex: source.faceIndex, font }
  }
  touchDetailFont(faceId, cached)
  return cached
}

async function clearPreviewCaches() {
  detailFonts.clear()
  await previewSubsets?.clearAll()
  const ses = window?.webContents?.session ?? session.defaultSession
  try {
    await ses.clearCache()
  } catch { /* ignore */ }
  try {
    await ses.clearCodeCaches({})
  } catch { /* ignore */ }
  try {
    await ses.clearStorageData({
      storages: ['cachestorage', 'serviceworkers', 'shadercache'],
    })
  } catch { /* ignore */ }
}
function createTrayIcon() {
  const source = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  if (!source.isEmpty()) {
    const size = process.platform === 'darwin' ? 22 : 16
    return source.resize({ width: size, height: size })
  }
  // Fallback when icon.png is missing (e.g. unexpected cwd layout).
  const size = 16
  const bytes = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1
      const mark = x >= 4 && x <= 6 && y >= 3 && y <= 12
        || x >= 4 && x <= 11 && y >= 3 && y <= 5
        || x >= 4 && x <= 10 && y >= 7 && y <= 9
      if (edge || mark) {
        bytes[i] = 0x52
        bytes[i + 1] = 0x6b
        bytes[i + 2] = 0x11
        bytes[i + 3] = 0xff
      } else {
        bytes[i] = 0xfa
        bytes[i + 1] = 0xfa
        bytes[i + 2] = 0xf7
        bytes[i + 3] = 0xff
      }
    }
  }
  return nativeImage.createFromBuffer(bytes, { width: size, height: size })
}
const trayIcon = createTrayIcon()

function showMainWindow() {
  if (!window) {
    createWindow()
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  if (!minimizeToTray) destroyTray()
}

function hideToTray() {
  ensureTray()
  window?.hide()
}

function quitApp() {
  isQuitting = true
  destroyTray()
  app.quit()
}

function ensureTray() {
  if (tray) return
  tray = new Tray(trayIcon)
  tray.setToolTip('Fontral')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() },
  ]))
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

function destroyTray() {
  tray?.destroy()
  tray = undefined
}

function setMinimizeToTray(enabled: boolean) {
  minimizeToTray = enabled
  if (enabled) ensureTray()
  else if (!window?.isVisible()) showMainWindow()
  else destroyTray()
}

function previewText(faceId: number, text: string) {
  // Prefer index-time cmap ranges so list browsing never opens full fonts.
  const source = database.previewPath(faceId)
  if (!source) throw new Error('找不到该字体文件。')
  const indexed = mapPreviewText(source.cmapRanges, text)
  if (indexed.fromIndex) return indexed.text

  // Legacy rows without cmap_ranges: one-shot fontkit fallback until rescan finishes.
  const cached = getDetailFont(faceId)
  return Array.from(text).map(character => {
    const code = character.codePointAt(0)
    if (code === undefined) return character
    return cached.font.hasGlyphForCodePoint(code) ? character : MISSING_GLYPH
  }).join('')
}

function parsePreviewRequest(url: string) {
  // font-preview://face/<id>?t=<urlencoded text>&full=1
  const match = /^font-preview:\/\/face\/(\d+)(?:[/?#]|$)/.exec(url)
  if (!match) return null
  let text = ''
  let full = false
  try {
    const params = new URL(url).searchParams
    text = normalizePreviewText(params.get('t') ?? '')
    full = params.get('full') === '1' || params.get('full') === 'true'
  } catch {
    text = ''
  }
  return { faceId: Number(match[1]), text, full }
}

const unicodeBlocks: Array<[number, number, string]> = [
  [0x0000, 0x007f, 'unicodeBlock.basicLatin'],
  [0x0080, 0x00ff, 'unicodeBlock.latin1Supplement'],
  [0x0100, 0x017f, 'unicodeBlock.latinExtendedA'],
  [0x0180, 0x024f, 'unicodeBlock.latinExtendedB'],
  [0x0250, 0x02af, 'unicodeBlock.ipaExtensions'],
  [0x02b0, 0x02ff, 'unicodeBlock.spacingModifierLetters'],
  [0x0300, 0x036f, 'unicodeBlock.combiningDiacriticalMarks'],
  [0x0370, 0x03ff, 'unicodeBlock.greekAndCoptic'],
  [0x0400, 0x052f, 'unicodeBlock.cyrillic'],
  [0x0530, 0x058f, 'unicodeBlock.armenian'],
  [0x0590, 0x05ff, 'unicodeBlock.hebrew'],
  [0x0600, 0x06ff, 'unicodeBlock.arabic'],
  [0x0700, 0x074f, 'unicodeBlock.syriac'],
  [0x0750, 0x077f, 'unicodeBlock.arabicSupplement'],
  [0x0780, 0x07bf, 'unicodeBlock.thaana'],
  [0x07c0, 0x07ff, 'unicodeBlock.nko'],
  [0x0800, 0x083f, 'unicodeBlock.samaritan'],
  [0x0840, 0x085f, 'unicodeBlock.mandaic'],
  [0x08a0, 0x08ff, 'unicodeBlock.arabicExtendedA'],
  [0x0900, 0x097f, 'unicodeBlock.devanagari'],
  [0x0980, 0x09ff, 'unicodeBlock.bengali'],
  [0x0a00, 0x0a7f, 'unicodeBlock.gurmukhi'],
  [0x0a80, 0x0aff, 'unicodeBlock.gujarati'],
  [0x0b00, 0x0b7f, 'unicodeBlock.oriya'],
  [0x0b80, 0x0bff, 'unicodeBlock.tamil'],
  [0x0c00, 0x0c7f, 'unicodeBlock.telugu'],
  [0x0c80, 0x0cff, 'unicodeBlock.kannada'],
  [0x0d00, 0x0d7f, 'unicodeBlock.malayalam'],
  [0x0d80, 0x0dff, 'unicodeBlock.sinhala'],
  [0x0e00, 0x0e7f, 'unicodeBlock.thai'],
  [0x0e80, 0x0eff, 'unicodeBlock.lao'],
  [0x0f00, 0x0fff, 'unicodeBlock.tibetan'],
  [0x1000, 0x109f, 'unicodeBlock.myanmar'],
  [0x10a0, 0x10ff, 'unicodeBlock.georgian'],
  [0x1100, 0x11ff, 'unicodeBlock.hangulJamo'],
  [0x1200, 0x137f, 'unicodeBlock.ethiopic'],
  [0x13a0, 0x13ff, 'unicodeBlock.cherokee'],
  [0x1400, 0x167f, 'unicodeBlock.unifiedCanadianAboriginalSyllabics'],
  [0x1680, 0x169f, 'unicodeBlock.ogham'],
  [0x16a0, 0x16ff, 'unicodeBlock.runic'],
  [0x1700, 0x171f, 'unicodeBlock.tagalog'],
  [0x1720, 0x173f, 'unicodeBlock.hanunoo'],
  [0x1740, 0x175f, 'unicodeBlock.buhid'],
  [0x1760, 0x177f, 'unicodeBlock.tagbanwa'],
  [0x1780, 0x17ff, 'unicodeBlock.khmer'],
  [0x1800, 0x18af, 'unicodeBlock.mongolian'],
  [0x1e00, 0x1eff, 'unicodeBlock.latinExtendedAdditional'],
  [0x1f00, 0x1fff, 'unicodeBlock.greekExtended'],
  [0x2000, 0x206f, 'unicodeBlock.generalPunctuation'],
  [0x2070, 0x209f, 'unicodeBlock.superscriptsAndSubscripts'],
  [0x20a0, 0x20cf, 'unicodeBlock.currencySymbols'],
  [0x20d0, 0x20ff, 'unicodeBlock.combiningDiacriticalMarksForSymbols'],
  [0x2100, 0x214f, 'unicodeBlock.letterlikeSymbols'],
  [0x2150, 0x218f, 'unicodeBlock.numberForms'],
  [0x2190, 0x21ff, 'unicodeBlock.arrows'],
  [0x2200, 0x22ff, 'unicodeBlock.mathematicalOperators'],
  [0x2300, 0x23ff, 'unicodeBlock.miscellaneousTechnical'],
  [0x2400, 0x243f, 'unicodeBlock.controlPictures'],
  [0x2440, 0x245f, 'unicodeBlock.opticalCharacterRecognition'],
  [0x2460, 0x24ff, 'unicodeBlock.enclosedAlphanumerics'],
  [0x2500, 0x257f, 'unicodeBlock.boxDrawing'],
  [0x2580, 0x259f, 'unicodeBlock.blockElements'],
  [0x25a0, 0x25ff, 'unicodeBlock.geometricShapes'],
  [0x2600, 0x26ff, 'unicodeBlock.miscellaneousSymbols'],
  [0x2700, 0x27bf, 'unicodeBlock.dingbats'],
  [0x27c0, 0x27ef, 'unicodeBlock.miscellaneousMathematicalSymbolsA'],
  [0x27f0, 0x27ff, 'unicodeBlock.supplementalArrowsA'],
  [0x2800, 0x28ff, 'unicodeBlock.braillePatterns'],
  [0x2900, 0x297f, 'unicodeBlock.supplementalArrowsB'],
  [0x2980, 0x29ff, 'unicodeBlock.miscellaneousMathematicalSymbolsB'],
  [0x2a00, 0x2aff, 'unicodeBlock.supplementalMathematicalOperators'],
  [0x2b00, 0x2bff, 'unicodeBlock.miscellaneousSymbolsAndArrows'],
  [0x2c00, 0x2c5f, 'unicodeBlock.glagolitic'],
  [0x2c60, 0x2c7f, 'unicodeBlock.latinExtendedC'],
  [0x2c80, 0x2cff, 'unicodeBlock.coptic'],
  [0x2d00, 0x2d2f, 'unicodeBlock.georgianSupplement'],
  [0x2d30, 0x2d7f, 'unicodeBlock.tifinagh'],
  [0x2de0, 0x2dff, 'unicodeBlock.cyrillicExtendedA'],
  [0x2e00, 0x2e7f, 'unicodeBlock.supplementalPunctuation'],
  [0x2e80, 0x2eff, 'unicodeBlock.cjkRadicalsSupplement'],
  [0x2f00, 0x2fdf, 'unicodeBlock.kangxiRadicals'],
  [0x2ff0, 0x2fff, 'unicodeBlock.ideographicDescriptionCharacters'],
  [0x3000, 0x303f, 'unicodeBlock.cjkSymbolsAndPunctuation'],
  [0x3040, 0x309f, 'unicodeBlock.hiragana'],
  [0x30a0, 0x30ff, 'unicodeBlock.katakana'],
  [0x3100, 0x312f, 'unicodeBlock.bopomofo'],
  [0x3130, 0x318f, 'unicodeBlock.hangulCompatibilityJamo'],
  [0x3190, 0x319f, 'unicodeBlock.kanbun'],
  [0x31a0, 0x31bf, 'unicodeBlock.bopomofoExtended'],
  [0x31c0, 0x31ef, 'unicodeBlock.cjkStrokes'],
  [0x31f0, 0x31ff, 'unicodeBlock.katakanaPhoneticExtensions'],
  [0x3200, 0x32ff, 'unicodeBlock.enclosedCJKLettersAndMonths'],
  [0x3300, 0x33ff, 'unicodeBlock.cjkCompatibility'],
  [0x3400, 0x4dbf, 'unicodeBlock.cjkUnifiedIdeographsExtensionA'],
  [0x4dc0, 0x4dff, 'unicodeBlock.yijingHexagramSymbols'],
  [0x4e00, 0x9fff, 'unicodeBlock.cjkUnifiedIdeographs'],
  [0xa000, 0xa48f, 'unicodeBlock.yiSyllables'],
  [0xa490, 0xa4cf, 'unicodeBlock.yiRadicals'],
  [0xa4d0, 0xa4ff, 'unicodeBlock.lisu'],
  [0xa500, 0xa63f, 'unicodeBlock.vai'],
  [0xa640, 0xa69f, 'unicodeBlock.cyrillicExtendedB'],
  [0xa6a0, 0xa6ff, 'unicodeBlock.bamum'],
  [0xa700, 0xa71f, 'unicodeBlock.modifierToneLetters'],
  [0xa720, 0xa7ff, 'unicodeBlock.latinExtendedD'],
  [0xa800, 0xa82f, 'unicodeBlock.sylotiNagri'],
  [0xa830, 0xa83f, 'unicodeBlock.commonIndicNumberForms'],
  [0xa840, 0xa87f, 'unicodeBlock.phagsPa'],
  [0xa880, 0xa8df, 'unicodeBlock.saurashtra'],
  [0xa8e0, 0xa8ff, 'unicodeBlock.devanagariExtended'],
  [0xa900, 0xa92f, 'unicodeBlock.kayahLi'],
  [0xa930, 0xa95f, 'unicodeBlock.rejang'],
  [0xa960, 0xa97f, 'unicodeBlock.hangulJamoExtendedA'],
  [0xa980, 0xa9df, 'unicodeBlock.javanese'],
  [0xaa00, 0xaa5f, 'unicodeBlock.cham'],
  [0xaa60, 0xaa7f, 'unicodeBlock.myanmarExtendedA'],
  [0xaa80, 0xaadf, 'unicodeBlock.taiViet'],
  [0xab00, 0xab2f, 'unicodeBlock.ethiopicExtendedA'],
  [0xab30, 0xab6f, 'unicodeBlock.latinExtendedE'],
  [0xab70, 0xabbf, 'unicodeBlock.cherokeeSupplement'],
  [0xac00, 0xd7af, 'unicodeBlock.hangulSyllables'],
  [0xd7b0, 0xd7ff, 'unicodeBlock.hangulJamoExtendedB'],
  [0xe000, 0xf8ff, 'unicodeBlock.privateUseArea'],
  [0xf900, 0xfaff, 'unicodeBlock.cjkCompatibilityIdeographs'],
  [0xfb00, 0xfb4f, 'unicodeBlock.alphabeticPresentationForms'],
  [0xfb50, 0xfdff, 'unicodeBlock.arabicPresentationFormsA'],
  [0xfe00, 0xfe0f, 'unicodeBlock.variationSelectors'],
  [0xfe10, 0xfe1f, 'unicodeBlock.verticalForms'],
  [0xfe20, 0xfe2f, 'unicodeBlock.combiningHalfMarks'],
  [0xfe30, 0xfe4f, 'unicodeBlock.cjkCompatibilityForms'],
  [0xfe50, 0xfe6f, 'unicodeBlock.smallFormVariants'],
  [0xfe70, 0xfeff, 'unicodeBlock.arabicPresentationFormsB'],
  [0xff00, 0xffef, 'unicodeBlock.halfwidthAndFullwidthForms'],
  [0xfff0, 0xffff, 'unicodeBlock.specials'],
  [0x10000, 0x1007f, 'unicodeBlock.linearBSyllabary'],
  [0x10100, 0x1013f, 'unicodeBlock.aegeanNumbers'],
  [0x10140, 0x1018f, 'unicodeBlock.ancientGreekNumbers'],
  [0x10300, 0x1032f, 'unicodeBlock.oldItalic'],
  [0x10330, 0x1034f, 'unicodeBlock.gothic'],
  [0x10380, 0x1039f, 'unicodeBlock.ugaritic'],
  [0x10400, 0x1044f, 'unicodeBlock.deseret'],
  [0x10450, 0x1047f, 'unicodeBlock.shavian'],
  [0x10480, 0x104af, 'unicodeBlock.osmanya'],
  [0x10800, 0x1083f, 'unicodeBlock.cypriotSyllabary'],
  [0x10900, 0x1091f, 'unicodeBlock.phoenician'],
  [0x10a00, 0x10a5f, 'unicodeBlock.kharoshthi'],
  [0x10b00, 0x10b3f, 'unicodeBlock.avestan'],
  [0x10d00, 0x10d3f, 'unicodeBlock.hanifiRohingya'],
  [0x1d000, 0x1d0ff, 'unicodeBlock.byzantineMusicalSymbols'],
  [0x1d100, 0x1d1ff, 'unicodeBlock.musicalSymbols'],
  [0x1d300, 0x1d35f, 'unicodeBlock.taiXuanJingSymbols'],
  [0x1d400, 0x1d7ff, 'unicodeBlock.mathematicalAlphanumericSymbols'],
  [0x1f000, 0x1f02f, 'unicodeBlock.mahjongTiles'],
  [0x1f030, 0x1f09f, 'unicodeBlock.dominoTiles'],
  [0x1f0a0, 0x1f0ff, 'unicodeBlock.playingCards'],
  [0x1f100, 0x1f1ff, 'unicodeBlock.enclosedAlphanumericSupplement'],
  [0x1f200, 0x1f2ff, 'unicodeBlock.enclosedIdeographicSupplement'],
  [0x1f300, 0x1f5ff, 'unicodeBlock.miscellaneousSymbolsAndPictographs'],
  [0x1f600, 0x1f64f, 'unicodeBlock.emoticons'],
  [0x1f680, 0x1f6ff, 'unicodeBlock.transportAndMapSymbols'],
  [0x1f780, 0x1f7ff, 'unicodeBlock.geometricShapesExtended'],
  [0x1f800, 0x1f8ff, 'unicodeBlock.supplementalArrowsC'],
  [0x1f900, 0x1f9ff, 'unicodeBlock.supplementalSymbolsAndPictographs'],
  [0x1fa00, 0x1faff, 'unicodeBlock.symbolsAndPictographsExtendedA'],
  [0x20000, 0x2a6df, 'unicodeBlock.cjkUnifiedIdeographsExtensionB'],
  [0x2a700, 0x2b73f, 'unicodeBlock.cjkUnifiedIdeographsExtensionC'],
  [0x2b740, 0x2b81f, 'unicodeBlock.cjkUnifiedIdeographsExtensionD'],
  [0x2b820, 0x2ceaf, 'unicodeBlock.cjkUnifiedIdeographsExtensionE'],
  [0x2ceb0, 0x2ebef, 'unicodeBlock.cjkUnifiedIdeographsExtensionF'],
  [0x30000, 0x3134f, 'unicodeBlock.cjkUnifiedIdeographsExtensionG'],
  [0x31350, 0x323af, 'unicodeBlock.cjkUnifiedIdeographsExtensionH'],
  [0xe0000, 0xe007f, 'unicodeBlock.tags'],
  [0xe0100, 0xe01ef, 'unicodeBlock.variationSelectorsSupplement'],
]
const localizedNameTypes: Record<string, string> = {   fontFamily: 'localizedNameType.fontFamily', fontSubfamily: 'localizedNameType.fontSubfamily', fullName: 'localizedNameType.fullName', preferredFamily: 'localizedNameType.preferredFamily', preferredSubfamily: 'localizedNameType.preferredSubfamily', compatibleFull: 'localizedNameType.compatibleFull', uniqueSubfamily: 'localizedNameType.uniqueSubfamily', postscriptName: 'localizedNameType.postscriptName', wwsFamilyName: 'localizedNameType.wwsFamilyName', wwsSubfamilyName: 'localizedNameType.wwsSubfamilyName' }
function formatCodePoint(value: number) { return `U+${value.toString(16).toUpperCase().padStart(4, '0')}` }

/** unicodeBlocks is sorted by start; locate the covering block in O(log n). */
function findUnicodeBlock(point: number): [number, number, string] {
  let lo = 0
  let hi = unicodeBlocks.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (unicodeBlocks[mid]![0] <= point) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (best >= 0) {
    const block = unicodeBlocks[best]!
    if (point >= block[0] && point <= block[1]) return block
  }
  return [point, point, 'unicodeBlock.unclassified']
}

function parseUnicodeRangeKey(key: string): { start: number; end: number } | null {
  const match = key.trim().match(/^U\+([0-9A-Fa-f]{4,6})-U\+([0-9A-Fa-f]{4,6})$/)
  if (!match) return null
  const start = Number.parseInt(match[1]!, 16)
  const end = Number.parseInt(match[2]!, 16)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null
  return { start, end }
}

function charDisplayName(codePoint: number) {
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return 'charCategory.control'
  if (codePoint === 0x20) return 'charCategory.space'
  if (codePoint === 0xa0) return 'charCategory.noBreakSpace'
  if (codePoint === 0x3000) return 'charCategory.ideographicSpace'
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) return 'charCategory.variationSelector'
  if (codePoint >= 0xe0100 && codePoint <= 0xe01ef) return 'charCategory.variationSelector'
  try {
    const char = String.fromCodePoint(codePoint)
    // Prefer a stable label that is still useful when the glyph itself is already shown above.
    if (/^\p{L}$/u.test(char)) return char
    if (/^\p{N}$/u.test(char)) return char
    if (/^\p{P}$/u.test(char)) return 'charCategory.punctuation'
    if (/^\p{S}$/u.test(char)) return 'charCategory.symbol'
    if (/^\p{M}$/u.test(char)) return 'charCategory.combiningMark'
    if (/^\p{Z}$/u.test(char)) return 'charCategory.whitespace'
    return char
  } catch {
    return formatCodePoint(codePoint)
  }
}

function toCharsetCharItem(codePoint: number, inFont: boolean) {
  let char = ''
  try { char = String.fromCodePoint(codePoint) } catch { char = '' }
  return {
    codePoint,
    char,
    name: charDisplayName(codePoint),
    inFont,
  }
}

function buildCharsetChars(
  title: string,
  codePoints: number[],
  fontPoints: Set<number>,
  page: number,
  pageSize: number,
  onlyInFont: boolean,
) {
  let covered = 0
  const filtered: number[] = []
  for (const codePoint of codePoints) {
    const inFont = fontPoints.has(codePoint)
    if (inFont) covered++
    if (!onlyInFont || inFont) filtered.push(codePoint)
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(Math.max(1, page), pageCount)
  const start = (safePage - 1) * pageSize
  const slice = filtered.slice(start, start + pageSize)
  const chars = slice.map(codePoint => toCharsetCharItem(codePoint, fontPoints.has(codePoint)))

  return {
    title,
    total: codePoints.length,
    covered,
    page: safePage,
    pageSize,
    pageCount,
    chars,
  }
}

function charsetCharsForFace(
  faceId: number,
  source: 'unicode' | 'cjk',
  key: string,
  page: number,
  pageSize: number,
  onlyInFont: boolean,
) {
  const font = getDetailFont(faceId).font
  const fontPoints = new Set(font.characterSet as Iterable<number>)

  if (source === 'unicode') {
    const range = parseUnicodeRangeKey(key)
    if (!range) throw new Error('无效的 Unicode 区块')
    const block = unicodeBlocks.find(([start, end]) => start === range.start && end === range.end)
    const title = block?.[2] ?? `${formatCodePoint(range.start)}-${formatCodePoint(range.end)}`
    const codePoints: number[] = []
    for (let cp = range.start; cp <= range.end; cp++) codePoints.push(cp)
    return buildCharsetChars(title, codePoints, fontPoints, page, pageSize, onlyInFont)
  }

  const cjkTable = getCjkCharsetCodePoints(key) ?? getCjkUnicodeBlockCodePoints(key)
  if (!cjkTable) throw new Error('找不到该字符集')
  return buildCharsetChars(cjkTable.name, cjkTable.codePoints, fontPoints, page, pageSize, onlyInFont)
}

function fontMetadata(faceId: number) {
  const font = getDetailFont(faceId).font
  const points = Array.from(font.characterSet as Iterable<number>).sort((a, b) => a - b)
  const blocks = new Map<string, { name: string; start: number; end: number; points: number[] }>()
  for (const point of points) {
    const [start, end, name] = findUnicodeBlock(point)
    const key = `${start}-${end}`
    const existing = blocks.get(key) ?? { name, start, end, points: [] }
    existing.points.push(point)
    blocks.set(key, existing)
  }
  const records = font.name?.records as Record<string, Record<string, unknown>> | undefined
  const localizedNames = Object.entries(localizedNameTypes).flatMap(([key, type]) => Object.entries(records?.[key] ?? {}).filter(([, value]) => typeof value === 'string').map(([language, value]) => ({ type, language, value: value as string })))
  const pickName = (key: string) => {
    const values = Object.entries(records?.[key] ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
      .map(([language, value]) => ({ language, value: value.trim() }))
    if (!values.length) return null
    const english = values.find(item => {
      const language = item.language.trim().toLowerCase().replace(/_/g, '-')
      return language === 'en' || language.startsWith('en-') || language === '0x409' || language === '1033'
    })
    return (english ?? values[0]).value
  }
  const os2 = font['OS/2'] as {
    usWeightClass?: number
    usWidthClass?: number
    fsSelection?: { italic?: boolean; bold?: boolean; regular?: boolean; oblique?: boolean }
    typoAscender?: number
    typoDescender?: number
    typoLineGap?: number
    winAscent?: number
    winDescent?: number
    xAvgCharWidth?: number
    yStrikeoutPosition?: number
    yStrikeoutSize?: number
    capHeight?: number
    xHeight?: number
    vendorID?: string
  } | undefined
  const selection = os2?.fsSelection
  const bbox = font.bbox as { minX?: number; minY?: number; maxX?: number; maxY?: number } | undefined
  const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  const metrics = {
    weight: num(os2?.usWeightClass) ?? num(font.variationAxes?.wght?.default) ?? null,
    widthClass: num(os2?.usWidthClass),
    isBold: typeof selection?.bold === 'boolean' ? selection.bold : null,
    isItalic: typeof selection?.italic === 'boolean' ? selection.italic : null,
    isOblique: typeof selection?.oblique === 'boolean' ? selection.oblique : null,
    isRegular: typeof selection?.regular === 'boolean' ? selection.regular : null,
    italicAngle: num(font.italicAngle),
    unitsPerEm: num(font.unitsPerEm),
    ascent: num(font.ascent),
    descent: num(font.descent),
    lineGap: num(font.lineGap),
    typoAscender: num(os2?.typoAscender),
    typoDescender: num(os2?.typoDescender),
    typoLineGap: num(os2?.typoLineGap),
    winAscent: num(os2?.winAscent),
    winDescent: num(os2?.winDescent),
    capHeight: num(font.capHeight) ?? num(os2?.capHeight),
    xHeight: num(font.xHeight) ?? num(os2?.xHeight),
    underlinePosition: num(font.underlinePosition),
    underlineThickness: num(font.underlineThickness),
    strikeoutPosition: num(os2?.yStrikeoutPosition),
    strikeoutSize: num(os2?.yStrikeoutSize),
    avgCharWidth: num(os2?.xAvgCharWidth),
    bboxMinX: num(bbox?.minX),
    bboxMinY: num(bbox?.minY),
    bboxMaxX: num(bbox?.maxX),
    bboxMaxY: num(bbox?.maxY),
  }
  const credits = {
    copyright: pickName('copyright'),
    trademark: pickName('trademark'),
    manufacturer: pickName('manufacturer'),
    designer: pickName('designer'),
    description: pickName('description'),
    vendorURL: pickName('vendorURL'),
    designerURL: pickName('designerURL'),
    license: pickName('license'),
    licenseURL: pickName('licenseURL'),
    version: pickName('version') ?? (typeof font.version === 'string' ? font.version : null),
    vendorID: typeof os2?.vendorID === 'string' && os2.vendorID.trim() ? os2.vendorID.trim() : null,
    sampleText: pickName('sampleText'),
  }
  let openTypeFeatures: Array<{ tag: string; name: string }> = []
  try {
    const tags = Array.from(new Set((font.availableFeatures as string[] | undefined) ?? [])).filter(tag => typeof tag === 'string' && tag.trim())
    openTypeFeatures = tags
      .map(tag => ({ tag, name: openTypeFeatureNames[tag] ?? tag }))
      .sort((a, b) => a.tag.localeCompare(b.tag))
  } catch {
    openTypeFeatures = []
  }
  return {
    localizedNames,
    unicodeBlocks: [...blocks.values()].map(block => ({
      name: block.name,
      range: `${formatCodePoint(block.start)}-${formatCodePoint(block.end)}`,
      codePointCount: block.points.length,
      blockTotal: block.end - block.start + 1,
    })),
    cjkCoverage: computeCjkCoverage(points),
    cjkCharacterCount: countCjkCharacters(points),
    inferredLanguage: inferFontLanguage(points),
    metrics,
    credits,
    openTypeFeatures,
  }
}

const openTypeFeatureNames: Record<string, string> = {
  aalt: 'otFeature.aalt',
  abvf: 'otFeature.abvf',
  abvm: 'otFeature.abvm',
  abvs: 'otFeature.abvs',
  afrc: 'otFeature.afrc',
  akhn: 'otFeature.akhn',
  blwf: 'otFeature.blwf',
  blwm: 'otFeature.blwm',
  blws: 'otFeature.blws',
  c2pc: 'otFeature.c2pc',
  c2sc: 'otFeature.c2sc',
  calt: 'otFeature.calt',
  case: 'otFeature.case',
  ccmp: 'otFeature.ccmp',
  cfar: 'otFeature.cfar',
  chws: 'otFeature.chws',
  cjct: 'otFeature.cjct',
  clig: 'otFeature.clig',
  cpct: 'otFeature.cpct',
  cpsp: 'otFeature.cpsp',
  cswh: 'otFeature.cswh',
  curs: 'otFeature.curs',
  dlig: 'otFeature.dlig',
  dnom: 'otFeature.dnom',
  dtls: 'otFeature.dtls',
  expt: 'otFeature.expt',
  falt: 'otFeature.falt',
  fin2: 'otFeature.fin2',
  fin3: 'otFeature.fin3',
  fina: 'otFeature.fina',
  flac: 'otFeature.flac',
  frac: 'otFeature.frac',
  fwid: 'otFeature.fwid',
  half: 'otFeature.half',
  haln: 'otFeature.haln',
  halt: 'otFeature.halt',
  hist: 'otFeature.hist',
  hkna: 'otFeature.hkna',
  hlig: 'otFeature.hlig',
  hngl: 'otFeature.hngl',
  hojo: 'otFeature.hojo',
  hwid: 'otFeature.hwid',
  init: 'otFeature.init',
  isol: 'otFeature.isol',
  ital: 'otFeature.ital',
  jalt: 'otFeature.jalt',
  jp04: 'otFeature.jp04',
  jp78: 'otFeature.jp78',
  jp83: 'otFeature.jp83',
  jp90: 'otFeature.jp90',
  kern: 'otFeature.kern',
  lfbd: 'otFeature.lfbd',
  liga: 'otFeature.liga',
  ljmo: 'otFeature.ljmo',
  lnum: 'otFeature.lnum',
  locl: 'otFeature.locl',
  ltra: 'otFeature.ltra',
  ltrm: 'otFeature.ltrm',
  mark: 'otFeature.mark',
  med2: 'otFeature.med2',
  medi: 'otFeature.medi',
  mgrk: 'otFeature.mgrk',
  mkmk: 'otFeature.mkmk',
  mset: 'otFeature.mset',
  nalt: 'otFeature.nalt',
  nlck: 'otFeature.nlck',
  nukt: 'otFeature.nukt',
  numr: 'otFeature.numr',
  onum: 'otFeature.onum',
  opbd: 'otFeature.opbd',
  ordn: 'otFeature.ordn',
  ornm: 'otFeature.ornm',
  palt: 'otFeature.palt',
  pcap: 'otFeature.pcap',
  pkna: 'otFeature.pkna',
  pnum: 'otFeature.pnum',
  pref: 'otFeature.pref',
  pres: 'otFeature.pres',
  pstf: 'otFeature.pstf',
  psts: 'otFeature.psts',
  pwid: 'otFeature.pwid',
  qwid: 'otFeature.qwid',
  rand: 'otFeature.rand',
  rclt: 'otFeature.rclt',
  rkrf: 'otFeature.rkrf',
  rlig: 'otFeature.rlig',
  rphf: 'otFeature.rphf',
  rtbd: 'otFeature.rtbd',
  rtla: 'otFeature.rtla',
  rtlm: 'otFeature.rtlm',
  ruby: 'otFeature.ruby',
  rvrn: 'otFeature.rvrn',
  salt: 'otFeature.salt',
  sinf: 'otFeature.sinf',
  size: 'otFeature.size',
  smcp: 'otFeature.smcp',
  smpl: 'otFeature.smpl',
  ssty: 'otFeature.ssty',
  stch: 'otFeature.stch',
  subs: 'otFeature.subs',
  sups: 'otFeature.sups',
  swsh: 'otFeature.swsh',
  titl: 'otFeature.titl',
  tjmo: 'otFeature.tjmo',
  tnam: 'otFeature.tnam',
  tnum: 'otFeature.tnum',
  trad: 'otFeature.trad',
  twid: 'otFeature.twid',
  unic: 'otFeature.unic',
  valt: 'otFeature.valt',
  vatu: 'otFeature.vatu',
  vchw: 'otFeature.vchw',
  vert: 'otFeature.vert',
  vhal: 'otFeature.vhal',
  vjmo: 'otFeature.vjmo',
  vkna: 'otFeature.vkna',
  vkrn: 'otFeature.vkrn',
  vpal: 'otFeature.vpal',
  vrt2: 'otFeature.vrt2',
  vrtr: 'otFeature.vrtr',
  zero: 'otFeature.zero',
}

for (let i = 1; i <= 99; i += 1) {
  openTypeFeatureNames[`cv${String(i).padStart(2, '0')}`] = `otFeature.cv${String(i).padStart(2, '0')}`
}
for (let i = 1; i <= 20; i += 1) {
  openTypeFeatureNames[`ss${String(i).padStart(2, '0')}`] = `otFeature.ss${String(i).padStart(2, '0')}`
}

function notifyLibraryChanged(immediate = false) {
  if (immediate) {
    if (libraryUpdateTimer) clearTimeout(libraryUpdateTimer)
    libraryUpdateTimer = undefined
    window?.webContents.send('library:changed')
  } else if (!libraryUpdateTimer) {
    libraryUpdateTimer = setTimeout(() => { libraryUpdateTimer = undefined; window?.webContents.send('library:changed') }, 100)
  }
}

/** Face index grew/changed — renderer should refresh the font list (throttled). */
function notifyIndexChanged(immediate = false) {
  if (immediate) {
    if (indexUpdateTimer) clearTimeout(indexUpdateTimer)
    indexUpdateTimer = undefined
    window?.webContents.send('fonts:index-changed')
  } else if (!indexUpdateTimer) {
    indexUpdateTimer = setTimeout(() => {
      indexUpdateTimer = undefined
      window?.webContents.send('fonts:index-changed')
    }, INDEX_UPDATE_MS)
  }
}
function notifyActivationStatus(record: import('@fontral/contracts').ActivationRecord) { window?.webContents.send('activation:status', record) }

/** Generate one family signature at a time only after foreground scanning is idle. */
function scheduleSimilarityWork(mode: SimilarityMode = 'family', priorityFaceId?: number) {
  if (mode === 'face') {
    faceSimilarityRequested = true
    similarityPriorityFaceId = priorityFaceId ?? similarityPriorityFaceId
  }
  if (similarityWorkScheduled || similarityWorkerActive) return
  similarityWorkScheduled = true
  setTimeout(() => {
    similarityWorkScheduled = false
    if (similarityWorkerActive || scans.size || scanWriteQueues.size) return
    const job = database.nextSimilarityJob(faceSimilarityRequested ? 'face' : 'family', similarityPriorityFaceId)
    if (!job) return
    similarityWorkerActive = true
    const worker = new Worker(join(__dirname, 'font-similarity-worker.js'), { workerData: job, execArgv: process.execArgv })
    worker.on('message', message => {
      if (message.type === 'feature') {
        database.saveSimilaritySignature(message.faceId, message.signature)
        notifyIndexChanged()
      }
      else if (message.type === 'error') {
        database.markSimilarityUnavailable(job.faceId)
        console.warn('[fontral] similarity feature skipped', job.faceId, message.error)
      }
    })
    worker.once('error', error => {
      database.markSimilarityUnavailable(job.faceId)
      console.warn('[fontral] similarity worker failed', job.faceId, error)
    })
    worker.once('exit', () => {
      similarityWorkerActive = false
      scheduleSimilarityWork()
    })
  }, 250)
}
function roots() {
  return database.rootTrees().map(root => ({ ...root, scanProgress: scanProgress.get(root.id) }))
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180, height: 760, minWidth: 800, minHeight: 600,
    frame: false,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  window.on('close', event => {
    if (isQuitting) return
    event.preventDefault()
    window?.webContents.send('window:close-requested')
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
}
function isPathInsideRoot(rootPath: string, targetPath: string) {
  const root = normalize(resolve(rootPath))
  const target = normalize(resolve(targetPath))
  const rootKey = root.toLowerCase()
  const targetKey = target.toLowerCase()
  return targetKey === rootKey || targetKey.startsWith(`${rootKey}\\`) || targetKey.startsWith(`${rootKey}/`)
}

function nextScanGeneration(rootId: number) {
  const generation = (scanGenerations.get(rootId) ?? 0) + 1
  scanGenerations.set(rootId, generation)
  return generation
}

function isLiveScan(rootId: number, generation: number, worker: ReturnType<typeof scanRoot>) {
  return scanGenerations.get(rootId) === generation && scans.get(rootId) === worker
}

/** Per-root DB write queue so scan upserts yield the main thread between files (details/IPC stay responsive). */
const scanWriteQueues = new Map<number, Array<{ generation: number; run: () => void }>>()
let scanWritePumping = false

function enqueueScanWrite(rootId: number, generation: number, run: () => void) {
  let queue = scanWriteQueues.get(rootId)
  if (!queue) {
    queue = []
    scanWriteQueues.set(rootId, queue)
  }
  queue.push({ generation, run })
  pumpScanWrites()
}

function pumpScanWrites() {
  if (scanWritePumping) return
  scanWritePumping = true
  const step = () => {
    let job: { generation: number; run: () => void } | undefined
    let jobRootId: number | undefined
    for (const [rootId, queue] of scanWriteQueues) {
      while (queue.length) {
        const next = queue[0]!
        if (scanGenerations.get(rootId) !== next.generation) {
          queue.shift()
          continue
        }
        job = queue.shift()
        jobRootId = rootId
        break
      }
      if (!queue.length) scanWriteQueues.delete(rootId)
      if (job) break
    }
    if (!job) {
      scanWritePumping = false
      return
    }
    try {
      job.run()
    } catch (error) {
      console.error('[fontral] scan write failed', jobRootId, error)
    }
    // Yield so fonts:details / preview IPC can run between heavy upserts.
    setImmediate(step)
  }
  setImmediate(step)
}

/** Invalidate in-flight scan handlers, drop progress, and terminate the worker. */
async function cancelScan(rootId: number) {
  const worker = scans.get(rootId)
  if (!worker && !scanWriteQueues.has(rootId)) return
  nextScanGeneration(rootId)
  scans.delete(rootId)
  scanProgress.delete(rootId)
  scanWriteQueues.delete(rootId)
  if (!worker) return
  try { await worker.terminate() } catch { /* already dead */ }
}

async function cancelAllScans() {
  const rootIds = new Set([...scans.keys(), ...scanWriteQueues.keys()])
  await Promise.all([...rootIds].map(rootId => cancelScan(rootId)))
}

function scan(rootId: number, pathPrefix?: string) {
  if (scans.has(rootId) || scanWriteQueues.has(rootId)) return
  const root = database.roots().find(item => item.id === rootId)
  if (!root) return
  const scopedPath = pathPrefix?.trim() ? normalize(resolve(pathPrefix.trim())) : undefined
  if (scopedPath && !isPathInsideRoot(root.path, scopedPath)) throw new Error('只能扫描已添加目录下的子目录')
  const generation = nextScanGeneration(rootId)
  database.setScanStatus(rootId, 'scanning')
  scanProgress.set(rootId, { processed: 0, total: 0 })
  notifyLibraryChanged(true)
  const fingerprints = Object.fromEntries(
    database.listFingerprints(rootId, scopedPath).map(item => [item.normalizedPath, { size: item.size, mtimeMs: item.mtimeMs }]),
  )
  const seen = new Set<string>()
  let worker: ReturnType<typeof scanRoot>
  const finish = (status: string) => {
    // Worker exit may race cancel; drop stale completions before queueing.
    if (scanGenerations.get(rootId) !== generation) return
    // Queue finalization after pending upserts so markMissing sees the full `seen` set.
    enqueueScanWrite(rootId, generation, () => {
      if (scanGenerations.get(rootId) !== generation) return
      if (status === 'idle') {
        database.markMissingNotSeen(rootId, seen, scopedPath)
        database.setLastScannedAt(rootId)
      }
      database.setScanStatus(rootId, status)
      scanProgress.delete(rootId)
      scans.delete(rootId)
      notifyIndexChanged(true)
      notifyLibraryChanged(true)
      scheduleSimilarityWork()
    })
  }
  worker = scanRoot(rootId, root.path, join(__dirname, 'font-scan-worker.js'), () => { finish('idle') }, error => { finish(`error: ${error.message}`) }, { pathPrefix: scopedPath, fingerprints })
  worker.on('message', message => {
    if (!isLiveScan(rootId, generation, worker)) return
    if (message.type === 'file') {
      const payload = message.payload
      enqueueScanWrite(rootId, generation, () => {
        if (scanGenerations.get(rootId) !== generation) return
        database.upsertFile(payload)
        seen.add(payload.normalizedPath as string)
        notifyIndexChanged()
      })
      return
    }
    if (message.type === 'unchanged') {
      const normalizedPath = message.normalizedPath as string
      enqueueScanWrite(rootId, generation, () => {
        if (scanGenerations.get(rootId) !== generation) return
        seen.add(normalizedPath)
        database.confirmPresent(normalizedPath)
      })
      return
    }
    if (message.type === 'start' || message.type === 'progress') {
      scanProgress.set(rootId, { processed: message.processed ?? 0, total: message.total ?? 0 })
      notifyLibraryChanged()
    }
  })
  scans.set(rootId, worker)
}

app.whenReady().then(async () => {
  database = new FontDatabase(join(app.getPath('userData'), 'fontral.db'))
  activationClient = new ActivationClient({
    agentEntry: join(__dirname, 'activation-agent.js'),
    journalDirectory: join(app.getPath('userData'), 'activation-journals'),
  })
  await activationClient.start()
  database.markStaleActivationSessionsRecovered()
  database.createActivationSession({ id: activationClient.sessionId, agentPid: activationClient.agentPid ?? 0, mainPid: process.pid, platform: process.platform })
  previewSubsets = new PreviewSubsetService(
    join(app.getPath('sessionData'), 'preview-subsets'),
    join(__dirname, 'preview-subset-worker.js'),
  )
  protocol.handle('font-preview', async request => {
    const parsed = parsePreviewRequest(request.url)
    if (!parsed) return new Response('Not found', { status: 404 })
    const source = database.previewPath(parsed.faceId)
    if (!source) return new Response('Not found', { status: 404 })
    try {
      const requestBase = {
        path: source.path,
        sha256: source.sha256,
        format: source.format,
        faceIndex: source.faceIndex,
        size: source.size,
        mtimeMs: source.mtimeMs,
      }
      const { body, contentType } = parsed.full
        ? await previewSubsets.getFullFace(requestBase)
        : await previewSubsets.getSubset({
          ...requestBase,
          text: (() => {
            const mapped = mapPreviewText(source.cmapRanges, parsed.text || ' ')
            // Keep only glyphs that exist so subsetter work stays minimal.
            return mapped.text.split(MISSING_GLYPH).join('') || ' '
          })(),
        })
      const copy = new ArrayBuffer(body.byteLength)
      new Uint8Array(copy).set(body)
      return new Response(copy, {
        headers: {
          'content-type': contentType,
          // Subset/full URL already encodes identity; immutable is safe within session.
          'cache-control': 'private, max-age=3600',
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Avoid spamming the console on known hard-to-subset faces while scrolling.
      if (!/hb_subset_or_fail|corrupted|Font too large/i.test(message)) {
        console.error('[fontral] preview subset failed', parsed.faceId, error)
      } else {
        console.warn('[fontral] preview subset unavailable', parsed.faceId, message)
      }
      return new Response('Preview failed', { status: 500 })
    }
  })
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' font-preview:; connect-src 'self'; img-src 'self' data: blob:"] } }))
  ipcMain.handle('fonts:query', (_event, input) => {
    const parsed = fontQuerySchema.parse(input)
    const { coversText: _omit, ...query } = parsed
    return database.query(query)
  })
  ipcMain.handle('fonts:family', (_event, family, filter) => database.family(fontFamilySchema.parse(family), filter === undefined ? undefined : folderFilterSchema.parse(filter)))
  ipcMain.handle('fonts:similar', (_event, id, mode) => {
    const faceId = faceIdSchema.parse(id)
    const similarityMode = similarityModeSchema.parse(mode ?? 'family')
    scheduleSimilarityWork(similarityMode, faceId)
    return database.similar(faceId, similarityMode)
  })
  ipcMain.handle('fonts:details', async (_event, id) => {
    const faceId = faceIdSchema.parse(id)
    const detail = database.faceDetails(faceId)
    if (!detail) return null
    // Yield once so a burst of scan writes does not starve this handler on the main thread.
    await new Promise<void>(resolve => setImmediate(resolve))
    return { ...detail, ...fontMetadata(faceId) }
  })
  ipcMain.handle('fonts:charset-chars', async (_event, input) => {
    const query = charsetCharsQuerySchema.parse(input)
    await new Promise<void>(resolve => setImmediate(resolve))
    return charsetCharsForFace(query.faceId, query.source, query.key, query.page, query.pageSize, query.onlyInFont)
  })
  ipcMain.handle('fonts:preview-text', async (_event, id, text) => {
    await new Promise<void>(resolve => setImmediate(resolve))
    return previewText(faceIdSchema.parse(id), typeof text === 'string' ? text.slice(0, 1_000) : '')
  })
  ipcMain.handle('fonts:update-user-data', (_event, input) => database.updateUserData(userDataSchema.parse(input)))
  ipcMain.handle('fonts:update-family-note', (_event, id, note) => {
    if (typeof note !== 'string' || note.length > 2_000) throw new Error('字体备注不能超过 2000 个字符')
    database.updateFamilyNote(faceIdSchema.parse(id), note)
  })
  ipcMain.handle('fonts:update-family-language', (_event, id, language) => {
    const value = language === null || language === undefined || language === ''
      ? null
      : fontLanguageSchema.parse(language)
    database.updateFamilyLanguage(faceIdSchema.parse(id), value)
  })
  ipcMain.handle('fonts:list-family-links', (_event, id) => database.listFamilyLinks(faceIdSchema.parse(id)))
  ipcMain.handle('fonts:add-family-link', (_event, id, targetId) => {
    database.addFamilyLink(faceIdSchema.parse(id), faceIdSchema.parse(targetId))
  })
  ipcMain.handle('fonts:remove-family-link', (_event, id, targetId) => {
    database.removeFamilyLink(faceIdSchema.parse(id), faceIdSchema.parse(targetId))
  })
  ipcMain.handle('fonts:list-tags', () => database.listTags())
  ipcMain.handle('fonts:update-family-tags', (_event, id, tags) => {
    database.updateFamilyTags(faceIdSchema.parse(id), familyTagsSchema.parse(tags))
  })
  ipcMain.handle('fonts:open-file', async (_event, id) => {
    const source = database.previewPath(faceIdSchema.parse(id))
    if (!source) throw new Error('找不到该字体文件。')
    const error = await shell.openPath(source.path)
    if (error) throw new Error(error || '无法打开字体文件。')
  })
  ipcMain.handle('fonts:reveal-in-folder', (_event, id) => {
    const source = database.previewPath(faceIdSchema.parse(id))
    if (!source) throw new Error('找不到该字体文件。')
    shell.showItemInFolder(source.path)
  })
  ipcMain.handle('fonts:clear-preview-cache', () => clearPreviewCaches())
  ipcMain.handle('library:list-roots', () => roots())
  ipcMain.handle('library:add-root', async () => { const result = await (window ? dialog.showOpenDialog(window, { properties: ['openDirectory'] }) : dialog.showOpenDialog({ properties: ['openDirectory'] })); if (result.canceled) return null; const rootId = database.addRoot(result.filePaths[0]); scan(rootId); return rootId })
  ipcMain.handle('library:rescan', (_event, id, path) => {
    const rootId = rootIdSchema.parse(id)
    const pathPrefix = path === undefined || path === null ? undefined : folderPathSchema.parse(path)
    scan(rootId, pathPrefix)
  })
  let rebuildChain: Promise<void> = Promise.resolve()
  ipcMain.handle('library:rebuild-database', () => {
    // Serialize rebuilds: a second click must not race scan()/cancel and stall progress.
    const run = rebuildChain.then(async () => {
      await cancelAllScans()
      detailFonts.clear()
      await clearPreviewCaches()
      database.clearFontIndex()
      notifyIndexChanged(true)
      notifyLibraryChanged(true)
      for (const root of database.roots()) scan(root.id)
    })
    rebuildChain = run.then(() => undefined, () => undefined)
    return run
  })
  ipcMain.handle('library:remove-root', async (_event, id) => {
    const rootId = rootIdSchema.parse(id)
    await cancelScan(rootId)
    database.removeRoot(rootId)
    notifyIndexChanged(true)
    notifyLibraryChanged(true)
  })
  ipcMain.handle('library:update-root-note', (_event, id, note) => { const rootId = rootIdSchema.parse(id); if (typeof note !== 'string' || note.length > 200) throw new Error('目录备注不能超过 200 个字符'); database.setRootNote(rootId, note.trim()); notifyLibraryChanged(true) })
  ipcMain.handle('library:update-folder-note', (_event, id, path, note) => {
    const rootId = rootIdSchema.parse(id)
    const folderPath = folderPathSchema.parse(path)
    if (typeof note !== 'string' || note.length > 200) throw new Error('目录备注不能超过 200 个字符')
    const root = database.roots().find(item => item.id === rootId)
    if (!root) throw new Error('找不到该字体目录。')
    if (!isPathInsideRoot(root.path, folderPath)) throw new Error('只能备注已添加目录下的子目录')
    database.setFolderNote(rootId, normalize(resolve(folderPath)), note.trim())
    notifyLibraryChanged(true)
  })
  ipcMain.handle('library:update-root-visible', (_event, id, visible) => { const rootId = rootIdSchema.parse(id); if (typeof visible !== 'boolean') throw new Error('目录展示状态无效'); database.setRootVisible(rootId, visible); notifyIndexChanged(true); notifyLibraryChanged(true) })
  ipcMain.handle('library:update-folder-visible', (_event, id, path, visible) => {
    const rootId = rootIdSchema.parse(id)
    const folderPath = folderPathSchema.parse(path)
    if (typeof visible !== 'boolean') throw new Error('目录展示状态无效')
    const root = database.roots().find(item => item.id === rootId)
    if (!root) throw new Error('找不到该字体目录。')
    if (!isPathInsideRoot(root.path, folderPath)) throw new Error('只能更新已添加目录下的子目录展示状态')
    database.setFolderVisible(rootId, normalize(resolve(folderPath)), visible)
    notifyIndexChanged(true)
    notifyLibraryChanged(true)
  })
  ipcMain.handle('library:open-folder', async (_event, input) => {
    if (typeof input !== 'string' || !input.trim()) throw new Error('目录路径无效')
    const target = normalize(resolve(input.trim()))
    const allowed = database.roots().some(root => isPathInsideRoot(root.path, target))
    if (!allowed) throw new Error('只能打开已添加的字体目录')
    const error = await shell.openPath(target)
    if (error) throw new Error(error || '无法打开文件夹。')
  })
  ipcMain.handle('window:minimize', () => window?.minimize())
  ipcMain.handle('window:maximize', () => window?.isMaximized() ? window.unmaximize() : window?.maximize())
  ipcMain.handle('window:close', () => window?.close())
  ipcMain.handle('window:confirm-close', (_event, action) => {
    if (action === 'tray' || (action !== 'quit' && minimizeToTray)) hideToTray()
    else quitApp()
  })
  ipcMain.handle('window:set-minimize-to-tray', (_event, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('托盘设置无效')
    setMinimizeToTray(enabled)
  })
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:open-external', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('只允许 http(s) 链接。')
    }
    await shell.openExternal(url)
  })
  ipcMain.handle('window:reload-app', () => {    // electron-vite dev 由父进程托管；完整 relaunch 会拆掉 dev server，只重载窗口。
    if (!app.isPackaged) {
      window?.webContents.reloadIgnoringCache()
      return
    }
    isQuitting = true
    app.relaunch()
    app.quit()
  })
  ipcMain.handle('activation:activate', async (_event, id) => {
    const faceId = faceIdSchema.parse(id)
    const target = database.resolveActivationTarget(faceId, activationClient.sessionId)
    if (!target) throw new Error('找不到该字体文件。')
    let record
    if (process.platform === 'linux') {
      const selection = await (window ? dialog.showOpenDialog(window, { title: '选择要使用该字体启动的应用（Linux 隔离模式）', properties: ['openFile'] }) : dialog.showOpenDialog({ title: '选择要使用该字体启动的应用（Linux 隔离模式）', properties: ['openFile'] }))
      if (selection.canceled || !selection.filePaths[0]) throw new Error('已取消 Linux 隔离启动。')
      record = await activationClient.launchIsolated(target, selection.filePaths[0])
    } else {
      record = await activationClient.activate(target)
    }
    database.saveActivationRecord(record, target)
    const hydrated = database.listActivationRecords(activationClient.sessionId).find(item => item.fileId === record.fileId) ?? record
    notifyActivationStatus(hydrated)
    return hydrated
  })
  ipcMain.handle('activation:deactivate', async (_event, id) => {
    const faceId = faceIdSchema.parse(id)
    const target = database.resolveActivationTarget(faceId, activationClient.sessionId)
    if (!target) throw new Error('找不到该字体文件。')
    const record = await activationClient.deactivate(target.fileId)
    database.saveActivationRecord(record, target)
    const hydrated = database.listActivationRecords(activationClient.sessionId).find(item => item.fileId === record.fileId) ?? record
    notifyActivationStatus(hydrated)
    return hydrated
  })
  ipcMain.handle('activation:list', () => database.listActivationRecords(activationClient.sessionId))
  createWindow()
  for (const root of database.roots()) scan(root.id)
  scheduleSimilarityWork()
})
app.on('window-all-closed', () => {
  if (minimizeToTray && !isQuitting) return
  if (process.platform !== 'darwin') quitApp()
})
app.on('before-quit', event => {
  if (quitCleanupComplete) return
  event.preventDefault()
  isQuitting = true
  destroyTray()
  for (const worker of scans.values()) worker.terminate()
  void (async () => {
    try {
      const records = await activationClient?.deactivateAll() ?? []
      for (const record of records) {
        const target = database.resolveActivationTarget(record.faceId, activationClient.sessionId)
        if (target) database.saveActivationRecord(record, target)
      }
      await activationClient?.stop()
      database?.finishActivationSession(activationClient.sessionId, 'clean')
    } catch (cause) {
      database?.finishActivationSession(activationClient.sessionId, 'failed', { code: 'cleanup_failed', message: cause instanceof Error ? cause.message : String(cause), retryable: true })
    } finally {
      try { await previewSubsets?.dispose() } catch { /* ignore */ }
      database?.close()
      quitCleanupComplete = true
      app.quit()
    }
  })()
})
app.on('activate', () => { showMainWindow() })
