import { ref } from 'vue'
import { en } from '../locales/en'
import { zhCN, type LocaleResource } from '../locales/zh-CN'
import { zhTW } from '../locales/zh-TW'

export const LOCALES = ['zh-CN', 'zh-TW', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export type TranslationKey = keyof LocaleResource
export type InterpolationParams = Record<string, string | number | null | undefined>

const resources: Record<Locale, LocaleResource> = { 'zh-CN': zhCN, 'zh-TW': zhTW, en }



export function resolveSystemLocale(): Locale {
  const systemLocale = typeof navigator === 'undefined' ? '' : navigator.language.toLowerCase()
  if (systemLocale === 'zh-tw' || systemLocale === 'zh-hk' || systemLocale === 'zh-mo' || systemLocale.startsWith('zh-hant')) return 'zh-TW'
  if (systemLocale.startsWith('zh')) return 'zh-CN'
  return 'en'
}

export const locale = ref<Locale>(resolveSystemLocale())

export const languages: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
}

function interpolate(message: string, params?: InterpolationParams) {
  if (!params) return message
  return message.replace(/{{\s*([\w.-]+)\s*}}/g, (placeholder, name: string) => {
    const value = params[name]
    return value === undefined || value === null ? placeholder : String(value)
  })
}

export function t(key: TranslationKey, params?: InterpolationParams) {
  return interpolate(resources[locale.value][key], params)
}

/** Translate a value that is itself a translation key, falling back unchanged. */
export function translateExternal(value: string) {
  return value in resources[locale.value] ? resources[locale.value][value as TranslationKey] : value
}

export function setLocale(value: Locale) {
  locale.value = value
  document.documentElement.lang = value
}

export function setupI18n() {
  setLocale(locale.value)
}

export function useI18n() {
  return { locale, languages, setLocale, t }
}
