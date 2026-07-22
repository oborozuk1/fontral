import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { SimilarityMode } from '@fontral/contracts'
import { LOCALES, resolveSystemLocale, setLocale, type Locale, type TranslationKey } from './useI18n'

type Translate = (key: TranslationKey) => string

export type FamilyNameMode = 'family' | 'preferred'
export type CopyNameType = 'fullName' | 'family' | 'preferredFamily' | 'postscript'
export type CopyNameLanguage = 'english' | 'locale'
export type ThemeScheme = 'light' | 'dark'
export type ThemeMode =
  | 'system'
  | 'light'
  | 'dark'
  | 'sepia'
  | 'sakura'
  | 'midnight'
  | 'ocean'
  | 'graphite'

export const THEME_IDS = [
  'system',
  'light',
  'dark',
  'sepia',
  'sakura',
  'midnight',
  'ocean',
  'graphite',
] as const satisfies readonly ThemeMode[]

const THEME_SCHEME: Record<Exclude<ThemeMode, 'system'>, ThemeScheme> = {
  light: 'light',
  dark: 'dark',
  sepia: 'light',
  sakura: 'light',
  midnight: 'dark',
  ocean: 'dark',
  graphite: 'dark',
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

export const COMMON_TAGS_MAX = 30
export const DEFAULT_COMMON_TAGS = [
  '衬线',
  '无衬线',
  '手写',
  '标题',
  '正文',
] as const

export type AppSettings = {
  language: Locale
  /** Built-in preset id, or PREVIEW_TEXT_CUSTOM_VALUE. */
  previewPreset: string
  /** Persisted custom default text. */
  customPreviewText: string
  /** User-editable text for every built-in preview preset. */
  previewPresetTexts: Record<string, string>
  previewFontSize: number
  /** Homepage view used on the next app launch. */
  defaultHomeViewMode: 'grid' | 'list'
  /** Family-page view used on the next app launch. */
  defaultDetailViewMode: 'grid' | 'list'
  groupByFamily: boolean
  showOpenFamilyButton: boolean
  /** Grid card width used on the next app launch and shown as the settings default. */
  defaultGridMinCol: number
  /** Whether the sidebar starts collapsed on the next app launch. */
  defaultSidebarCollapsed: boolean
  showSidebarTagline: boolean
  sidebarWidth: number
  lazyPreview: boolean
  prefetchAhead: number
  /** Max decoded preview FontFace entries kept in renderer memory. */
  previewCacheMax: number
  /** Load full faces instead of text-keyed subsets (higher memory/disk). */
  fullPreview: boolean
  /** Concurrent Chromium decodes while loading full preview faces. */
  fullPreviewConcurrent: number
  uiFont: string
  monoFont: string
  familyNameMode: FamilyNameMode
  similarityMode: SimilarityMode
  copyNameType: CopyNameType
  copyNameLanguage: CopyNameLanguage
  minimizeToTray: boolean
  theme: ThemeMode
  commonTags: string[]
}

export const SIDEBAR_WIDTH_MIN = 200
export const SIDEBAR_WIDTH_MAX = 480
export const SIDEBAR_WIDTH_DEFAULT = 292

export const GRID_MIN_COL_MIN = 160
export const GRID_MIN_COL_MAX = 420
export const GRID_MIN_COL_DEFAULT = 240
export const GRID_MIN_COL_STEP = 10

export function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)))
}

export function clampGridMinCol(width: number) {
  const stepped = Math.round(width / GRID_MIN_COL_STEP) * GRID_MIN_COL_STEP
  return Math.min(GRID_MIN_COL_MAX, Math.max(GRID_MIN_COL_MIN, stepped))
}

export const PREVIEW_CACHE_MAX_MIN = 30
export const PREVIEW_CACHE_MAX_MAX = 500
export const PREVIEW_CACHE_MAX_DEFAULT = 100
export const PREVIEW_CACHE_MAX_STEP = 10

export function clampPreviewCacheMax(value: number) {
  if (!Number.isFinite(value)) return PREVIEW_CACHE_MAX_DEFAULT
  const stepped = Math.round(value / PREVIEW_CACHE_MAX_STEP) * PREVIEW_CACHE_MAX_STEP
  return Math.min(PREVIEW_CACHE_MAX_MAX, Math.max(PREVIEW_CACHE_MAX_MIN, stepped))
}

export const FULL_PREVIEW_CONCURRENT_MIN = 1
export const FULL_PREVIEW_CONCURRENT_MAX = 9
export const FULL_PREVIEW_CONCURRENT_DEFAULT = 3

export function clampFullPreviewConcurrent(value: number) {
  if (!Number.isFinite(value)) return FULL_PREVIEW_CONCURRENT_DEFAULT
  return Math.min(FULL_PREVIEW_CONCURRENT_MAX, Math.max(FULL_PREVIEW_CONCURRENT_MIN, Math.round(value)))
}

export const DEFAULT_UI_FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
export const DEFAULT_MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const LEGACY_DEFAULT_UI_FONTS = new Set([
  'Inter, "Microsoft YaHei", system-ui, sans-serif',
  'Inter, Microsoft YaHei, system-ui, sans-serif',
])
const SETTINGS_KEY = 'fontral.settings'

export const PREVIEW_TEXT_PRESETS = [
  { id: 'english-short', label: 'ui.englishSentence', text: 'Sphinx of black quartz, judge my vow.' },
  { id: 'chinese-simplified', label: 'ui.simplifiedChineseSentence', text: '永和九年，岁在癸丑，暮春之初。' },
  { id: 'chinese-traditional', label: 'ui.traditionalChineseSentence', text: '落霞與孤鶩齊飛，秋水共長天一色。' },
  { id: 'japanese', label: 'ui.japaneseSentence', text: 'いろはにほへと ちりぬるを' },
  { id: 'numbers-symbols', label: 'ui.numbersAndSymbols', text: '0123456789 !@#$%^&*()_+-=[]{}' },
] as const

export const PREVIEW_TEXT_CUSTOM_VALUE = '__custom__'
export const DEFAULT_CUSTOM_PREVIEW_TEXT = '预览字体效果'

export function previewTextPresetOptions(t: Translate) {
  return [
    ...PREVIEW_TEXT_PRESETS.map(({ id, label }) => ({ label: t(label), value: id })),
    { label: t('ui.custom'), value: PREVIEW_TEXT_CUSTOM_VALUE },
  ]
}

export function isPreviewPresetId(value: string) {
  return value === PREVIEW_TEXT_CUSTOM_VALUE || PREVIEW_TEXT_PRESETS.some(preset => preset.id === value)
}

function defaultPreviewPresetTexts(): Record<string, string> {
  return Object.fromEntries(PREVIEW_TEXT_PRESETS.map(preset => [preset.id, preset.text]))
}

export function resolvePreviewText(
  preset: string,
  presetTexts: Record<string, string>,
  customText: string,
) {
  if (preset === PREVIEW_TEXT_CUSTOM_VALUE) return customText.slice(0, 200)
  return (presetTexts[preset] ?? defaultPreviewPresetTexts()[preset] ?? customText).slice(0, 200)
}

export type FocusableInput = {
  focus: () => void
  select?: () => void
}

export type PreviewTextPresetModelOptions = {
  /** Persisted settings preset. Without this the component keeps session state. */
  activePreset?: Ref<string>
  /** Homepage starts from the saved default preset. */
  initialPreset?: string
  /** Saved preset content. */
  presetTexts?: Ref<Record<string, string>>
  /** Saved custom text. */
  savedCustomText?: Ref<string>
  /** Persist selected preset (settings only). */
  onPresetChange?: (preset: string) => void
  /** Persist content for the selected preset (settings only). */
  onTextCommit?: (preset: string, text: string) => void
}

/** Shared preset + text field model for settings (persist) and homepage (session). */
export function usePreviewTextPresetModel(
  previewText: Ref<string>,
  options: PreviewTextPresetModelOptions = {},
) {
  const sessionPreset = ref(options.initialPreset ?? PREVIEW_TEXT_CUSTOM_VALUE)
  const inputRef = ref<FocusableInput | null>(null)

  watch(
    () => options.activePreset?.value,
    preset => {
      if (typeof preset === 'string' && isPreviewPresetId(preset)) previewText.value = getPresetText(preset)
    },
  )

  function getPresetText(preset: string) {
    return resolvePreviewText(preset, options.presetTexts?.value ?? defaultPreviewPresetTexts(), options.savedCustomText?.value ?? '')
  }

  function activePreset() {
    return options.activePreset?.value ?? sessionPreset.value
  }

  const selectedPreset = computed({
    get: activePreset,
    set: value => {
      if (typeof value !== 'string' || !isPreviewPresetId(value)) return
      sessionPreset.value = value
      previewText.value = getPresetText(value)
      options.onPresetChange?.(value)
      if (value === PREVIEW_TEXT_CUSTOM_VALUE) void nextTick(() => inputRef.value?.focus())
    },
  })

  function onTextInput(value: string) {
    const next = value.slice(0, 200)
    previewText.value = next
    if (options.activePreset) {
      options.onTextCommit?.(activePreset(), next)
      return
    }
    // Homepage edits become a temporary custom preview and never write settings.
    sessionPreset.value = PREVIEW_TEXT_CUSTOM_VALUE
  }

  return { selectedPreset, inputRef, onTextInput }
}

export function normalizeCommonTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [...DEFAULT_COMMON_TAGS]
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 32)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(name)
    if (result.length >= COMMON_TAGS_MAX) break
  }
  return result
}

export function defaultSettings(): AppSettings {
  return {
    language: resolveSystemLocale(),
    previewPreset: PREVIEW_TEXT_PRESETS[0].id,
    customPreviewText: DEFAULT_CUSTOM_PREVIEW_TEXT,
    previewPresetTexts: defaultPreviewPresetTexts(),
    previewFontSize: 32,
    defaultHomeViewMode: 'grid',
    defaultDetailViewMode: 'list',
    groupByFamily: false,
    showOpenFamilyButton: true,
    defaultGridMinCol: GRID_MIN_COL_DEFAULT,
    defaultSidebarCollapsed: false,
    showSidebarTagline: true,
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    lazyPreview: true,
    prefetchAhead: 12,
    previewCacheMax: PREVIEW_CACHE_MAX_DEFAULT,
    fullPreview: false,
    fullPreviewConcurrent: FULL_PREVIEW_CONCURRENT_DEFAULT,
    uiFont: DEFAULT_UI_FONT,
    monoFont: DEFAULT_MONO_FONT,
    familyNameMode: 'preferred',
    similarityMode: 'family',
    copyNameType: 'fullName',
    copyNameLanguage: 'english',
    minimizeToTray: false,
    theme: 'system',
    commonTags: [...DEFAULT_COMMON_TAGS],
  }
}

function migratePreviewSettings(parsed: Partial<AppSettings> & { previewText?: string }) {
  const base = defaultSettings()
  const previewPresetTexts = { ...base.previewPresetTexts }
  if (parsed.previewPresetTexts && typeof parsed.previewPresetTexts === 'object') {
    for (const preset of PREVIEW_TEXT_PRESETS) {
      const text = parsed.previewPresetTexts[preset.id]
      if (typeof text === 'string') previewPresetTexts[preset.id] = text.slice(0, 200)
    }
  }
  const customPreviewText = typeof parsed.customPreviewText === 'string'
    ? parsed.customPreviewText.slice(0, 200)
    : typeof parsed.previewText === 'string' && !PREVIEW_TEXT_PRESETS.some(preset => preset.text === parsed.previewText)
      ? parsed.previewText.slice(0, 200)
      : base.customPreviewText

  if (typeof parsed.previewPreset === 'string' && isPreviewPresetId(parsed.previewPreset)) {
    return {
      previewPreset: parsed.previewPreset,
      customPreviewText: customPreviewText || base.customPreviewText,
      previewPresetTexts,
    }
  }

  // Previous versions used the preset text itself as the stored identifier.
  if (typeof parsed.previewPreset === 'string') {
    const legacyPreset = PREVIEW_TEXT_PRESETS.find(preset => preset.text === parsed.previewPreset)
    if (legacyPreset) {
      return {
        previewPreset: legacyPreset.id,
        customPreviewText: customPreviewText || base.customPreviewText,
        previewPresetTexts,
      }
    }
  }

  // Legacy: single previewText field held either a preset value or free text.
  if (typeof parsed.previewText === 'string') {
    const text = parsed.previewText.slice(0, 200)
    const legacyPreset = PREVIEW_TEXT_PRESETS.find(preset => preset.text === text)
    if (legacyPreset) {
      return {
        previewPreset: legacyPreset.id,
        customPreviewText: customPreviewText || base.customPreviewText,
        previewPresetTexts,
      }
    }
    return {
      previewPreset: PREVIEW_TEXT_CUSTOM_VALUE,
      customPreviewText: text || base.customPreviewText,
      previewPresetTexts,
    }
  }

  return {
    previewPreset: base.previewPreset,
    customPreviewText: customPreviewText || base.customPreviewText,
    previewPresetTexts,
  }
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings()
    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      previewText?: string
      copyNameMode?: 'fullNameEn' | 'fullName' | 'family' | 'preferredFamily' | 'postscript'
      homeViewMode?: 'grid' | 'list'
      detailViewMode?: 'grid' | 'list'
      gridMinCol?: number
    }
    const base = defaultSettings()
    const preview = migratePreviewSettings(parsed)
    return {
      language: (LOCALES as readonly string[]).includes(parsed.language as string) ? parsed.language as Locale : base.language,
      previewPreset: preview.previewPreset,
      customPreviewText: preview.customPreviewText,
      previewPresetTexts: preview.previewPresetTexts,
      previewFontSize: typeof parsed.previewFontSize === 'number' ? Math.min(160, Math.max(20, Math.round(parsed.previewFontSize / 2) * 2)) : base.previewFontSize,
      // Previous versions persisted the active view; retain it as the startup default once.
      defaultHomeViewMode: parsed.defaultHomeViewMode === 'list' || parsed.homeViewMode === 'list' ? 'list' : 'grid',
      defaultDetailViewMode: parsed.defaultDetailViewMode === 'grid' || parsed.detailViewMode === 'grid' ? 'grid' : 'list',
      groupByFamily: Boolean(parsed.groupByFamily),
      showOpenFamilyButton: parsed.showOpenFamilyButton !== false,
      // Previous versions persisted the live width as gridMinCol; retain it as the default.
      defaultGridMinCol: typeof parsed.defaultGridMinCol === 'number'
        ? clampGridMinCol(parsed.defaultGridMinCol)
        : typeof parsed.gridMinCol === 'number'
          ? clampGridMinCol(parsed.gridMinCol)
          : base.defaultGridMinCol,
      defaultSidebarCollapsed: Boolean(parsed.defaultSidebarCollapsed),
      showSidebarTagline: parsed.showSidebarTagline !== false,
      sidebarWidth: typeof parsed.sidebarWidth === 'number' ? clampSidebarWidth(parsed.sidebarWidth) : base.sidebarWidth,
      lazyPreview: parsed.lazyPreview !== false,
      prefetchAhead: typeof parsed.prefetchAhead === 'number'
        ? Math.min(32, Math.max(0, Math.round(parsed.prefetchAhead)))
        : base.prefetchAhead,
      previewCacheMax: typeof parsed.previewCacheMax === 'number'
        ? clampPreviewCacheMax(parsed.previewCacheMax)
        : base.previewCacheMax,
      fullPreview: Boolean(parsed.fullPreview),
      fullPreviewConcurrent: typeof parsed.fullPreviewConcurrent === 'number'
        ? clampFullPreviewConcurrent(parsed.fullPreviewConcurrent)
        : base.fullPreviewConcurrent,
      uiFont: (() => {
        if (typeof parsed.uiFont !== 'string' || !parsed.uiFont.trim()) return base.uiFont
        const value = parsed.uiFont.trim().slice(0, 200)
        return LEGACY_DEFAULT_UI_FONTS.has(value) ? base.uiFont : value
      })(),
      monoFont: typeof parsed.monoFont === 'string' && parsed.monoFont.trim()
        ? parsed.monoFont.trim().slice(0, 200)
        : base.monoFont,
      familyNameMode: parsed.familyNameMode === 'family' ? 'family' : 'preferred',
      similarityMode: parsed.similarityMode === 'face' ? 'face' : 'family',
      copyNameType: parsed.copyNameType === 'fullName'
        || parsed.copyNameType === 'family'
        || parsed.copyNameType === 'preferredFamily'
        || parsed.copyNameType === 'postscript'
        ? parsed.copyNameType
        : parsed.copyNameMode === 'family'
          || parsed.copyNameMode === 'preferredFamily'
          || parsed.copyNameMode === 'postscript'
          ? parsed.copyNameMode
          : base.copyNameType,
      copyNameLanguage: parsed.copyNameLanguage === 'locale'
        ? 'locale'
        : parsed.copyNameMode === 'fullName'
          ? 'locale'
          : base.copyNameLanguage,
      minimizeToTray: Boolean(parsed.minimizeToTray),
      theme: isThemeMode(parsed.theme) ? parsed.theme : base.theme,
      commonTags: normalizeCommonTags(parsed.commonTags),
    }
  } catch {
    return defaultSettings()
  }
}

export function applyUiFont(font: string) {
  document.documentElement.style.setProperty('--ui-font', font.trim() || DEFAULT_UI_FONT)
}

export function applyMonoFont(font: string) {
  document.documentElement.style.setProperty('--mono', font.trim() || DEFAULT_MONO_FONT)
}

export function resolveTheme(mode: ThemeMode): Exclude<ThemeMode, 'system'> {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function themeScheme(mode: ThemeMode): ThemeScheme {
  return THEME_SCHEME[resolveTheme(mode)]
}

let themeAnimTimer: number | undefined

export function applyTheme(mode: ThemeMode, options?: { animate?: boolean }) {
  const resolved = resolveTheme(mode)
  const scheme = THEME_SCHEME[resolved]
  const root = document.documentElement

  const paint = () => {
    root.dataset.theme = resolved
    root.style.colorScheme = scheme
  }

  const shouldAnimate = Boolean(options?.animate)
    && root.dataset.theme
    && root.dataset.theme !== resolved
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!shouldAnimate) {
    window.clearTimeout(themeAnimTimer)
    root.classList.remove('theme-animating')
    paint()
    return
  }

  window.clearTimeout(themeAnimTimer)
  root.classList.add('theme-animating')
  // Arm transitions before token swap; rAF avoids sync layout thrash.
  requestAnimationFrame(() => {
    paint()
    themeAnimTimer = window.setTimeout(() => {
      root.classList.remove('theme-animating')
      themeAnimTimer = undefined
    }, 240)
  })
}

export function italicOptions(t: Translate) {
  return [{ label: t('ui.commonAll'), value: '' }, { label: t('ui.upright'), value: 'normal' }, { label: t('ui.italic'), value: 'italic' }] as const
}

export function variableOptions(t: Translate) {
  return [{ label: t('ui.commonAll'), value: '' }, { label: t('ui.variableFonts'), value: 'yes' }, { label: t('ui.staticFonts'), value: 'no' }] as const
}

export function languageFilterOptions(t: Translate) {
  return [
    { label: t('fontLanguage.simplifiedChinese'), value: 'fontLanguage.simplifiedChinese' }, { label: t('fontLanguage.traditionalChinese'), value: 'fontLanguage.traditionalChinese' }, { label: t('fontLanguage.simplifiedAndTraditionalChinese'), value: 'fontLanguage.simplifiedAndTraditionalChinese' },
    { label: t('fontLanguage.japanese'), value: 'fontLanguage.japanese' }, { label: t('fontLanguage.korean'), value: 'fontLanguage.korean' }, { label: t('fontLanguage.latin'), value: 'fontLanguage.latin' }, { label: t('fontLanguage.other'), value: 'fontLanguage.other' },
  ] as const
}

export const formatFilterOptions = [
  { label: 'TTF', value: 'ttf' },
  { label: 'OTF', value: 'otf' },
  { label: 'TTC', value: 'ttc' },
  { label: 'OTC', value: 'otc' },
  { label: 'WOFF', value: 'woff' },
  { label: 'WOFF2', value: 'woff2' },
] as const

export function viewModeOptions(t: Translate) {
  return [{ label: t('ui.grid'), value: 'grid' }, { label: t('ui.list'), value: 'list' }] as const
}

export const prefetchAheadOptions = [
  { label: '不预加载', value: 0 },
  { label: '4', value: 4 },
  { label: '8', value: 8 },
  { label: '16', value: 16 },
  { label: '24', value: 24 },
] as const

export const previewCacheMaxOptions = [
  { label: '10', value: 10 },
  { label: '20', value: 20 },
  { label: '30', value: 30 },
  { label: '40', value: 40 },
  { label: '50', value: 50 },
  { label: '60', value: 60 },
  { label: '70', value: 70 },
  { label: '80', value: 80 },
  { label: '90', value: 90 },
  { label: '100', value: 100 },
] as const

export function familyNameModeOptions(t: Translate) {
  return [{ label: t('ui.preferredFamilyName'), value: 'preferred' }, { label: t('ui.familyName'), value: 'family' }] as const
}

export function similarityModeOptions(t: Translate) {
  return [{ label: t('ui.byFamilyRepresentative'), value: 'family' }, { label: t('ui.byFace'), value: 'face' }] as const
}

export function copyNameTypeOptions(t: Translate) {
  return [{ label: t('ui.fullName'), value: 'fullName' }, { label: t('ui.familyName'), value: 'family' }, { label: t('ui.preferredFamilyName'), value: 'preferredFamily' }, { label: t('ui.postscriptName'), value: 'postscript' }] as const
}

export function copyNameLanguageOptions(t: Translate) {
  return [{ label: t('ui.preferEnglish'), value: 'english' }, { label: t('ui.preferLocalized'), value: 'locale' }] as const
}

export function themeModeOptions(t: Translate) {
  const labels = { system: 'ui.system', light: 'ui.light', dark: 'ui.dark', sepia: 'ui.sepia', sakura: 'ui.sakura', midnight: 'ui.midnight', ocean: 'ui.ocean', graphite: 'ui.graphite' } as const
  return ['system', 'light', 'dark', 'sepia', 'sakura', 'midnight', 'ocean', 'graphite'].map(value => ({ label: t(labels[value as keyof typeof labels]), value: value as ThemeMode }))
}

export function useSettings(selectedFamily: Ref<string | null>) {
  const initial = loadSettings()
  const language = ref<Locale>(initial.language)
  const settingsOpen = ref(false)
  /** Persisted preset id (built-in id or PREVIEW_TEXT_CUSTOM_VALUE). */
  const previewPreset = ref(initial.previewPreset)
  const customPreviewText = ref(initial.customPreviewText)
  const previewPresetTexts = ref(initial.previewPresetTexts)
  /** Settings editor text; mirrors resolved default while settings are open. */
  const defaultPreviewText = ref(resolvePreviewText(initial.previewPreset, initial.previewPresetTexts, initial.customPreviewText))
  const defaultPreviewFontSize = ref(initial.previewFontSize)
  /** Live homepage/detail preview text (session); starts from saved default. */
  const previewText = ref(resolvePreviewText(initial.previewPreset, initial.previewPresetTexts, initial.customPreviewText))
  /** Live font size; homepage changes are session-only until settings default is edited. */
  const previewFontSize = ref(initial.previewFontSize)
  const pendingPreviewFontSize = ref(initial.previewFontSize)
  const homeViewMode = ref<'grid' | 'list'>(initial.defaultHomeViewMode)
  const detailViewMode = ref<'grid' | 'list'>(initial.defaultDetailViewMode)
  const defaultHomeViewMode = ref<'grid' | 'list'>(initial.defaultHomeViewMode)
  const defaultDetailViewMode = ref<'grid' | 'list'>(initial.defaultDetailViewMode)
  const groupByFamily = ref(initial.groupByFamily)
  const showOpenFamilyButton = ref(initial.showOpenFamilyButton)
  const defaultGridMinCol = ref(initial.defaultGridMinCol)
  /** Live grid card width (session); starts from the saved default. */
  const gridMinCol = ref(initial.defaultGridMinCol)
  const lazyPreview = ref(initial.lazyPreview)
  const prefetchAhead = ref(initial.prefetchAhead)
  const previewCacheMax = ref(initial.previewCacheMax)
  const fullPreview = ref(initial.fullPreview)
  const fullPreviewConcurrent = ref(initial.fullPreviewConcurrent)
  const uiFont = ref(initial.uiFont)
  const monoFont = ref(initial.monoFont)
  const familyNameMode = ref<FamilyNameMode>(initial.familyNameMode)
  const similarityMode = ref<SimilarityMode>(initial.similarityMode)
  const copyNameType = ref<CopyNameType>(initial.copyNameType)
  const copyNameLanguage = ref<CopyNameLanguage>(initial.copyNameLanguage)
  const minimizeToTray = ref(initial.minimizeToTray)
  const theme = ref<ThemeMode>(initial.theme)
  const commonTags = ref<string[]>(initial.commonTags)
  // The active state is session-only; the setting only controls the next launch.
  const sidebarCollapsed = ref(initial.defaultSidebarCollapsed)
  const defaultSidebarCollapsed = ref(initial.defaultSidebarCollapsed)
  const showSidebarTagline = ref(initial.showSidebarTagline)
  const sidebarWidth = ref(initial.sidebarWidth)
  const settingsFocus = ref<'general' | 'tags'>('general')
  let previewFontSizeFrame: number | undefined
  let systemThemeMedia: MediaQueryList | undefined

  applyUiFont(initial.uiFont)
  setLocale(initial.language)
  applyMonoFont(initial.monoFont)
  applyTheme(initial.theme)
  void window.fontral?.window.setMinimizeToTray(initial.minimizeToTray)

  function handleSystemThemeChange() {
    if (theme.value === 'system') applyTheme('system', { animate: true })
  }

  systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
  systemThemeMedia.addEventListener('change', handleSystemThemeChange)

  const viewMode = computed({
    get: () => (selectedFamily.value ? detailViewMode.value : homeViewMode.value),
    set: mode => {
      if (selectedFamily.value) detailViewMode.value = mode
      else homeViewMode.value = mode
    },
  })

  function persistSettings() {
    const next: AppSettings = {
      language: language.value,
      previewPreset: isPreviewPresetId(previewPreset.value)
        ? previewPreset.value
        : PREVIEW_TEXT_CUSTOM_VALUE,
      customPreviewText: customPreviewText.value.slice(0, 200),
      previewPresetTexts: Object.fromEntries(
        PREVIEW_TEXT_PRESETS.map(preset => [preset.id, (previewPresetTexts.value[preset.id] ?? preset.text).slice(0, 200)]),
      ),
      previewFontSize: defaultPreviewFontSize.value,
      defaultHomeViewMode: defaultHomeViewMode.value,
      defaultDetailViewMode: defaultDetailViewMode.value,
      groupByFamily: groupByFamily.value,
      showOpenFamilyButton: showOpenFamilyButton.value,
      defaultGridMinCol: clampGridMinCol(defaultGridMinCol.value),
      defaultSidebarCollapsed: defaultSidebarCollapsed.value,
      showSidebarTagline: showSidebarTagline.value,
      sidebarWidth: clampSidebarWidth(sidebarWidth.value),
      lazyPreview: lazyPreview.value,
      prefetchAhead: prefetchAhead.value,
      previewCacheMax: clampPreviewCacheMax(previewCacheMax.value),
      fullPreview: fullPreview.value,
      fullPreviewConcurrent: clampFullPreviewConcurrent(fullPreviewConcurrent.value),
      uiFont: uiFont.value,
      monoFont: monoFont.value,
      familyNameMode: familyNameMode.value,
      similarityMode: similarityMode.value,
      copyNameType: copyNameType.value,
      copyNameLanguage: copyNameLanguage.value,
      minimizeToTray: minimizeToTray.value,
      theme: theme.value,
      commonTags: normalizeCommonTags(commonTags.value),
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  }

  function resolvedDefaultPreviewText() {
    return resolvePreviewText(previewPreset.value, previewPresetTexts.value, customPreviewText.value)
  }

  function syncLivePreviewFromDefaults() {
    previewText.value = resolvedDefaultPreviewText()
  }

  function setDefaultPreviewPreset(preset: string) {
    if (!isPreviewPresetId(preset)) return
    previewPreset.value = preset
    defaultPreviewText.value = resolvedDefaultPreviewText()
    syncLivePreviewFromDefaults()
    persistSettings()
  }

  function setDefaultPreviewText(preset: string, text: string) {
    if (!isPreviewPresetId(preset)) return
    const next = text.slice(0, 200)
    if (preset === PREVIEW_TEXT_CUSTOM_VALUE) customPreviewText.value = next
    else previewPresetTexts.value = { ...previewPresetTexts.value, [preset]: next }
    previewPreset.value = preset
    defaultPreviewText.value = next
    syncLivePreviewFromDefaults()
    persistSettings()
  }

  function resetSettings() {
    const defaults = defaultSettings()
    language.value = defaults.language
    setLocale(defaults.language)
    previewPreset.value = defaults.previewPreset
    customPreviewText.value = defaults.customPreviewText
    previewPresetTexts.value = defaults.previewPresetTexts
    defaultPreviewText.value = resolvePreviewText(defaults.previewPreset, defaults.previewPresetTexts, defaults.customPreviewText)
    previewText.value = defaultPreviewText.value
    defaultPreviewFontSize.value = defaults.previewFontSize
    previewFontSize.value = defaults.previewFontSize
    pendingPreviewFontSize.value = defaults.previewFontSize
    defaultHomeViewMode.value = defaults.defaultHomeViewMode
    defaultDetailViewMode.value = defaults.defaultDetailViewMode
    groupByFamily.value = defaults.groupByFamily
    showOpenFamilyButton.value = defaults.showOpenFamilyButton
    defaultGridMinCol.value = defaults.defaultGridMinCol
    gridMinCol.value = defaults.defaultGridMinCol
    defaultSidebarCollapsed.value = defaults.defaultSidebarCollapsed
    showSidebarTagline.value = defaults.showSidebarTagline
    sidebarWidth.value = defaults.sidebarWidth
    lazyPreview.value = defaults.lazyPreview
    prefetchAhead.value = defaults.prefetchAhead
    previewCacheMax.value = defaults.previewCacheMax
    fullPreview.value = defaults.fullPreview
    fullPreviewConcurrent.value = defaults.fullPreviewConcurrent
    uiFont.value = defaults.uiFont
    monoFont.value = defaults.monoFont
    familyNameMode.value = defaults.familyNameMode
    similarityMode.value = defaults.similarityMode
    copyNameType.value = defaults.copyNameType
    copyNameLanguage.value = defaults.copyNameLanguage
    minimizeToTray.value = defaults.minimizeToTray
    theme.value = defaults.theme
    commonTags.value = [...defaults.commonTags]
    applyUiFont(defaults.uiFont)
    applyMonoFont(defaults.monoFont)
    applyTheme(defaults.theme, { animate: true })
    void window.fontral?.window.setMinimizeToTray(defaults.minimizeToTray)
    persistSettings()
  }

  function schedulePreviewFontSize() {
    if (previewFontSizeFrame !== undefined) return
    previewFontSizeFrame = window.requestAnimationFrame(() => {
      previewFontSizeFrame = undefined
      previewFontSize.value = pendingPreviewFontSize.value
    })
  }

  function applyPreviewFontSize() {
    clearPreviewFontSizeTimer()
    previewFontSize.value = pendingPreviewFontSize.value
  }

  function scheduleDefaultPreviewFontSize() {
    // Settings default is already bound; keep session in sync so the change is visible now.
    pendingPreviewFontSize.value = defaultPreviewFontSize.value
    schedulePreviewFontSize()
    persistSettings()
  }

  function applyDefaultPreviewFontSize() {
    pendingPreviewFontSize.value = defaultPreviewFontSize.value
    applyPreviewFontSize()
    persistSettings()
  }

  function toggleViewMode() {
    viewMode.value = viewMode.value === 'grid' ? 'list' : 'grid'
  }

  const settingsReady = ref(false)
  let settingsReadyTimer: number | undefined

  function openSettings(focus: 'general' | 'tags' = 'general') {
    settingsFocus.value = focus
    // Rehydrate editor from persisted defaults when opening settings.
    defaultPreviewText.value = resolvedDefaultPreviewText()
    settingsReady.value = false
    settingsOpen.value = true
    window.clearTimeout(settingsReadyTimer)
    settingsReadyTimer = window.setTimeout(() => { settingsReady.value = true }, 50)
  }

  function clearSettingsReadyTimer() {
    window.clearTimeout(settingsReadyTimer)
  }

  function closeSettings() {
    settingsOpen.value = false
    settingsReady.value = false
    settingsFocus.value = 'general'
    clearSettingsReadyTimer()
    persistSettings()
  }

  function handleSettingsKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && settingsOpen.value) closeSettings()
  }

  function clearPreviewFontSizeTimer() {
    if (previewFontSizeFrame === undefined) return
    window.cancelAnimationFrame(previewFontSizeFrame)
    previewFontSizeFrame = undefined
  }

  // Homepage preview text/size are session-only; only settings defaults are persisted.
  watch([language, defaultHomeViewMode, defaultDetailViewMode, groupByFamily, showOpenFamilyButton, defaultGridMinCol, sidebarWidth, lazyPreview, prefetchAhead, previewCacheMax, fullPreview, fullPreviewConcurrent, familyNameMode, similarityMode, copyNameType, copyNameLanguage, commonTags, defaultSidebarCollapsed, showSidebarTagline], () => persistSettings(), { deep: true })
  watch(language, value => setLocale(value))
  watch(minimizeToTray, value => {
    void window.fontral?.window.setMinimizeToTray(value)
    persistSettings()
  })
  watch(uiFont, value => {
    applyUiFont(value)
    persistSettings()
  })
  watch(monoFont, value => {
    applyMonoFont(value)
    persistSettings()
  })
  watch(theme, value => {
    applyTheme(value, { animate: true })
    persistSettings()
  })

  function disposeSettings() {
    systemThemeMedia?.removeEventListener('change', handleSystemThemeChange)
    systemThemeMedia = undefined
  }

  return {
    settingsOpen,
    language,
    settingsReady,
    previewPreset,
    customPreviewText,
    previewPresetTexts,
    defaultPreviewText,
    previewText,
    defaultPreviewFontSize,
    previewFontSize,
    pendingPreviewFontSize,
    homeViewMode,
    detailViewMode,
    defaultHomeViewMode,
    defaultDetailViewMode,
    groupByFamily,
    showOpenFamilyButton,
    defaultGridMinCol,
    gridMinCol,
    lazyPreview,
    prefetchAhead,
    previewCacheMax,
    fullPreview,
    fullPreviewConcurrent,
    uiFont,
    monoFont,
    familyNameMode,
    similarityMode,
    copyNameType,
    copyNameLanguage,
    minimizeToTray,
    theme,
    commonTags,
    sidebarCollapsed,
    defaultSidebarCollapsed,
    showSidebarTagline,
    sidebarWidth,
    settingsFocus,
    viewMode,
    persistSettings,
    resetSettings,
    setDefaultPreviewPreset,
    setDefaultPreviewText,
    schedulePreviewFontSize,
    applyPreviewFontSize,
    scheduleDefaultPreviewFontSize,
    applyDefaultPreviewFontSize,
    toggleViewMode,
    openSettings,
    closeSettings,
    clearSettingsReadyTimer,
    handleSettingsKeydown,
    clearPreviewFontSizeTimer,
    disposeSettings,
  }
}
