<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type FontFaceDetail, type FontMetrics } from '@fontral/contracts'
import DetailSection from './DetailSection.vue'
import { fileSize } from '../composables/useFonts'
import { translateExternal, useI18n } from '../composables/useI18n'

const props = defineProps<{
  selectedDetail: FontFaceDetail | null
  detailLoading: boolean
}>()

const emit = defineEmits<{
  'copy-name': [value: string]
  error: [message: string]
}>()

const { locale, t } = useI18n()

const widthClassLabels: Record<number, string> = {
  1: 'Ultra-condensed',
  2: 'Extra-condensed',
  3: 'Condensed',
  4: 'Semi-condensed',
  5: 'Medium',
  6: 'Semi-expanded',
  7: 'Expanded',
  8: 'Extra-expanded',
  9: 'Ultra-expanded',
}

function formatMetric(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return t('ui.notProvided')
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

function formatTimestamp(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return t('ui.commonUnknown')
  return new Date(value).toLocaleString(locale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatFlag(value: boolean | null | undefined) {
  if (value === null || value === undefined) return t('ui.notProvided')
  return value ? t('ui.yes') : t('ui.no')
}

function formatWidthClass(value: number | null | undefined) {
  if (value === null || value === undefined) return t('ui.notProvided')
  return widthClassLabels[value] ? `${value}（${widthClassLabels[value]}）` : String(value)
}

const primaryLanguageRegions: Record<string, string> = {
  af: 'ZA', am: 'ET', ar: 'SA', as: 'IN', az: 'AZ', be: 'BY', bg: 'BG', bn: 'BD', bo: 'CN',
  br: 'FR', bs: 'BA', ca: 'ES', co: 'FR', cs: 'CZ', cy: 'GB', da: 'DK', de: 'DE', el: 'GR',
  en: 'US', es: 'ES', et: 'EE', eu: 'ES', fa: 'IR', fi: 'FI', fil: 'PH', fo: 'FO', fr: 'FR',
  fy: 'NL', ga: 'IE', gd: 'GB', gl: 'ES', gu: 'IN', ha: 'NG', he: 'IL', hi: 'IN', hr: 'HR',
  hsb: 'DE', hu: 'HU', hy: 'AM', id: 'ID', ig: 'NG', is: 'IS', it: 'IT', iu: 'CA', ja: 'JP',
  ka: 'GE', kk: 'KZ', kl: 'GL', km: 'KH', kn: 'IN', ko: 'KR', kok: 'IN', ky: 'KG', lb: 'LU',
  lo: 'LA', lt: 'LT', lv: 'LV', mi: 'NZ', mk: 'MK', ml: 'IN', mn: 'MN', mr: 'IN', ms: 'MY',
  mt: 'MT', nb: 'NO', ne: 'NP', nl: 'NL', nn: 'NO', nso: 'ZA', oc: 'FR', or: 'IN', pa: 'IN',
  pl: 'PL', ps: 'AF', pt: 'BR', qu: 'PE', ro: 'RO', ru: 'RU', rw: 'RW', sa: 'IN', se: 'NO',
  si: 'LK', sk: 'SK', sl: 'SI', sq: 'AL', sr: 'RS', sv: 'SE', sw: 'KE', ta: 'IN', te: 'IN',
  tg: 'TJ', th: 'TH', tk: 'TM', tn: 'ZA', tr: 'TR', tt: 'RU', ug: 'CN', uk: 'UA', ur: 'PK',
  uz: 'UZ', vi: 'VN', wo: 'SN', xh: 'ZA', yo: 'NG', zh: 'CN', zu: 'ZA',
}

const windowsLcidTags: Record<number, string> = {
  0x0409: 'en-US', 0x0809: 'en-GB', 0x0c09: 'en-AU', 0x1009: 'en-CA', 0x1409: 'en-NZ',
  0x1809: 'en-IE', 0x1c09: 'en-ZA', 0x2009: 'en-JM', 0x2409: 'en-029', 0x2809: 'en-BZ',
  0x2c09: 'en-TT', 0x3009: 'en-ZW', 0x3409: 'en-PH', 0x4009: 'en-IN', 0x4409: 'en-MY',
  0x4809: 'en-SG', 0x0404: 'zh-TW', 0x0804: 'zh-CN', 0x0c04: 'zh-HK', 0x1004: 'zh-SG',
  0x1404: 'zh-MO', 0x040c: 'fr-FR', 0x080c: 'fr-BE', 0x0c0c: 'fr-CA', 0x100c: 'fr-CH',
  0x140c: 'fr-LU', 0x180c: 'fr-MC', 0x0407: 'de-DE', 0x0807: 'de-CH', 0x0c07: 'de-AT',
  0x1007: 'de-LU', 0x1407: 'de-LI', 0x0411: 'ja-JP', 0x0412: 'ko-KR', 0x0410: 'it-IT',
  0x0810: 'it-CH', 0x040a: 'es-ES', 0x080a: 'es-MX', 0x0c0a: 'es-ES', 0x0416: 'pt-BR',
  0x0816: 'pt-PT', 0x0419: 'ru-RU', 0x0415: 'pl-PL', 0x0413: 'nl-NL', 0x0813: 'nl-BE',
}

function formatLanguageTag(language: string) {
  const raw = language.trim()
  if (!raw) return 'und'

  const hexMatch = raw.match(/^(?:0x)?([0-9a-f]{3,4})$/i)
  if (hexMatch) {
    const lcid = Number.parseInt(hexMatch[1]!, 16)
    if (windowsLcidTags[lcid]) return windowsLcidTags[lcid]
  }

  const platformMatch = raw.match(/^\d+-(\d+)$/)
  if (platformMatch) {
    const lcid = Number(platformMatch[1])
    if (windowsLcidTags[lcid]) return windowsLcidTags[lcid]
  }

  const parts = raw.replace(/_/g, '-').split('-').filter(Boolean)
  if (!parts.length) return 'und'

  const languageCode = parts[0]!.toLowerCase()
  if (parts.length === 1) {
    const region = primaryLanguageRegions[languageCode]
    return region ? `${languageCode}-${region}` : languageCode
  }

  const rest = parts.slice(1).map(part => {
    if (/^[a-z]{2}$/i.test(part)) return part.toUpperCase()
    if (/^[a-z]{4}$/i.test(part)) return part[0]!.toUpperCase() + part.slice(1).toLowerCase()
    return part
  })
  return [languageCode, ...rest].join('-')
}

function formatBBox(metrics: FontMetrics) {
  const values = [metrics.bboxMinX, metrics.bboxMinY, metrics.bboxMaxX, metrics.bboxMaxY]
  if (values.some(value => value === null || value === undefined)) return t('ui.notProvided')
  return `${values[0]}, ${values[1]} → ${values[2]}, ${values[3]}`
}

const copiedLocalizedKey = ref<string | null>(null)
let copiedLocalizedTimer: number | undefined

function localizedNameKey(name: { type: string; language: string; value: string }) {
  return `${name.type}\0${name.language}\0${name.value}`
}

function copyLocalizedName(name: { type: string; language: string; value: string }) {
  const key = localizedNameKey(name)
  copiedLocalizedKey.value = key
  window.clearTimeout(copiedLocalizedTimer)
  copiedLocalizedTimer = window.setTimeout(() => {
    if (copiedLocalizedKey.value === key) copiedLocalizedKey.value = null
  }, 1_500)
  emit('copy-name', name.value)
}

async function openFontFile() {
  const faceId = props.selectedDetail?.id
  if (!faceId) return
  try {
    await window.fontral.fonts.openFile(faceId)
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : t('ui.couldNotOpenFontFile'))
  }
}

type ParameterSectionId = 'basic' | 'style' | 'metrics' | 'credits' | 'features' | 'names' | 'axes'

const sectionsEl = ref<HTMLElement | null>(null)
const columnCount = ref(1)
const sectionColumns = ref<ParameterSectionId[][]>([[]])
const openSections = ref<Record<ParameterSectionId, boolean>>({
  basic: true,
  style: true,
  metrics: true,
  credits: true,
  features: true,
  names: true,
  axes: true,
})
let sectionsObserver: ResizeObserver | null = null

function resolveColumnCount(width: number) {
  if (width >= 1920) return 4
  if (width >= 1580) return 3
  if (width >= 1180) return 2
  return 1
}

function sectionWeight(id: ParameterSectionId, detail: FontFaceDetail) {
  if (id === 'names') return Math.max(2, detail.localizedNames.length)
  if (id === 'basic') return 6
  if (id === 'style') return 7
  if (id === 'metrics') return 12
  if (id === 'credits') {
    return Math.max(2, [
      detail.credits.copyright,
      detail.credits.trademark,
      detail.credits.manufacturer,
      detail.credits.designer,
      detail.credits.vendorID,
      detail.credits.version,
      detail.credits.vendorURL,
      detail.credits.designerURL,
      detail.credits.license,
      detail.credits.licenseURL,
      detail.credits.description,
      detail.credits.sampleText,
    ].filter(value => value?.trim()).length * 2)
  }
  if (id === 'features') return Math.max(2, detail.openTypeFeatures.length)
  return Math.max(2, detail.axes.length * 2)
}

function visibleSectionIds(detail: FontFaceDetail): ParameterSectionId[] {
  const ids: ParameterSectionId[] = ['names', 'basic', 'style', 'metrics']
  if ([
    detail.credits.copyright,
    detail.credits.trademark,
    detail.credits.manufacturer,
    detail.credits.designer,
    detail.credits.vendorID,
    detail.credits.version,
    detail.credits.vendorURL,
    detail.credits.designerURL,
    detail.credits.license,
    detail.credits.licenseURL,
    detail.credits.description,
    detail.credits.sampleText,
  ].some(value => value?.trim())) {
    ids.push('credits')
  }
  ids.push('features')
  if (detail.axes.length) ids.push('axes')
  return ids
}

function packSections(detail: FontFaceDetail, cols: number) {
  const ids = visibleSectionIds(detail)
  const columns: ParameterSectionId[][] = Array.from({ length: cols }, () => [])
  const heights = Array.from({ length: cols }, () => 0)
  for (const id of ids) {
    let best = 0
    for (let i = 1; i < cols; i++) {
      if (heights[i]! < heights[best]!) best = i
    }
    columns[best]!.push(id)
    heights[best]! += sectionWeight(id, detail)
  }
  sectionColumns.value = columns
}

function syncSectionColumns() {
  const detail = props.selectedDetail
  if (!detail) {
    sectionColumns.value = [[]]
    return
  }
  const width = sectionsEl.value?.clientWidth || window.innerWidth
  const cols = resolveColumnCount(width)
  columnCount.value = cols
  packSections(detail, cols)
}

function ensureSectionsObserver() {
  if (sectionsObserver) return sectionsObserver
  sectionsObserver = new ResizeObserver(() => {
    if (!props.selectedDetail) return
    const width = sectionsEl.value?.clientWidth || 0
    const cols = resolveColumnCount(width)
    if (cols === columnCount.value && sectionColumns.value.length === cols) return
    columnCount.value = cols
    packSections(props.selectedDetail, cols)
  })
  return sectionsObserver
}

onMounted(() => {
  if (sectionsEl.value) ensureSectionsObserver().observe(sectionsEl.value)
})

watch(sectionsEl, (el, prev) => {
  const observer = ensureSectionsObserver()
  if (prev) observer.unobserve(prev)
  if (el) {
    observer.observe(el)
    syncSectionColumns()
  }
})

watch(
  () => props.selectedDetail,
  async () => {
    await nextTick()
    syncSectionColumns()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  window.clearTimeout(copiedLocalizedTimer)
  sectionsObserver?.disconnect()
  sectionsObserver = null
})

const styleRows = computed(() => {
  const metrics = props.selectedDetail?.metrics
  if (!metrics) return []
  return [
    { label: t('ui.weight'), value: formatMetric(metrics.weight ?? props.selectedDetail?.weight) },
    { label: t('ui.widthClass'), value: formatWidthClass(metrics.widthClass) },
    { label: t('ui.bold'), value: formatFlag(metrics.isBold) },
    { label: t('ui.italic2'), value: formatFlag(metrics.isItalic) },
    { label: t('ui.oblique'), value: formatFlag(metrics.isOblique) },
    { label: t('ui.regular'), value: formatFlag(metrics.isRegular) },
    { label: t('ui.italicAngle'), value: formatMetric(metrics.italicAngle) },
  ]
})

const metricRows = computed(() => {
  const metrics = props.selectedDetail?.metrics
  if (!metrics) return []
  return [
    { label: 'unitsPerEm', value: formatMetric(metrics.unitsPerEm) },
    { label: 'Ascent (hhea)', value: formatMetric(metrics.ascent) },
    { label: 'Descent (hhea)', value: formatMetric(metrics.descent) },
    { label: 'LineGap (hhea)', value: formatMetric(metrics.lineGap) },
    { label: 'Typo Ascender', value: formatMetric(metrics.typoAscender) },
    { label: 'Typo Descender', value: formatMetric(metrics.typoDescender) },
    { label: 'Typo LineGap', value: formatMetric(metrics.typoLineGap) },
    { label: 'Win Ascent', value: formatMetric(metrics.winAscent) },
    { label: 'Win Descent', value: formatMetric(metrics.winDescent) },
    { label: 'Cap Height', value: formatMetric(metrics.capHeight) },
    { label: 'x-Height', value: formatMetric(metrics.xHeight) },
    { label: t('ui.underlinePosition'), value: formatMetric(metrics.underlinePosition) },
    { label: t('ui.underlineThickness'), value: formatMetric(metrics.underlineThickness) },
    { label: t('ui.strikeoutPosition'), value: formatMetric(metrics.strikeoutPosition) },
    { label: t('ui.strikeoutThickness'), value: formatMetric(metrics.strikeoutSize) },
    { label: t('ui.averageCharacterWidth'), value: formatMetric(metrics.avgCharWidth) },
    { label: t('ui.boundingBox'), value: formatBBox(metrics) },
  ]
})

const creditRows = computed(() => {
  const credits = props.selectedDetail?.credits
  if (!credits) return []
  return [
    { label: t('ui.copyright'), value: credits.copyright, multiline: true }, { label: t('ui.trademark'), value: credits.trademark, multiline: true }, { label: t('ui.manufacturer'), value: credits.manufacturer }, { label: t('ui.designer'), value: credits.designer }, { label: t('ui.vendorId'), value: credits.vendorID }, { label: t('ui.version'), value: credits.version }, { label: t('ui.vendorUrl'), value: credits.vendorURL }, { label: t('ui.designerUrl'), value: credits.designerURL }, { label: t('ui.license'), value: credits.license, multiline: true }, { label: t('ui.licenseUrl'), value: credits.licenseURL }, { label: t('ui.description'), value: credits.description, multiline: true }, { label: t('ui.sampleText'), value: credits.sampleText, multiline: true },
  ].filter((row): row is { label: string; value: string; multiline?: boolean } => Boolean(row.value?.trim()))
})
</script>

<template>
  <section class="detail-panel detail-panel--parameters">
    <p v-if="detailLoading && !selectedDetail" class="muted">{{ t('ui.loadingParameters') }}</p>
    <div
      v-else-if="selectedDetail"
      ref="sectionsEl"
      class="detail-sections"
      :style="{ '--cols': String(columnCount) }"
    >
      <div v-for="(column, columnIndex) in sectionColumns" :key="columnIndex" class="detail-sections-col">
        <template v-for="sectionId in column" :key="sectionId">
          <DetailSection v-if="sectionId === 'names'" v-model:open="openSections.names" :title="t('ui.localizedNames')">
            <div v-if="selectedDetail.localizedNames.length" class="localized-names">
              <div
                v-for="name in selectedDetail.localizedNames"
                :key="`${name.type}-${name.language}-${name.value}`"
              >
                <span>{{ translateExternal(name.type) }}</span>
                <small>{{ formatLanguageTag(name.language) }}</small>
                <button
                  type="button"
                  class="localized-name-value"
                  :class="{ 'is-copied': copiedLocalizedKey === localizedNameKey(name) }"
                   :data-tooltip="copiedLocalizedKey === localizedNameKey(name) ? t('ui.copied') : t('ui.clickToCopy')"
                  @click="copyLocalizedName(name)"
                >
                  {{ name.value }}
                </button>
              </div>
            </div>
             <p v-else class="muted">{{ t('ui.thisFontProvidesNoLocalizedNameRecords') }}</p>
          </DetailSection>

          <DetailSection v-else-if="sectionId === 'basic'" v-model:open="openSections.basic" :title="t('ui.basicInformation')">
            <dl class="detail-list">
              <div>
                 <dt>{{ t('ui.format') }}</dt>
                 <dd>{{ selectedDetail.format?.toUpperCase() || t('ui.commonUnknown') }}</dd>
              </div>
              <div>
                 <dt>{{ t('ui.version') }}</dt>
                 <dd>{{ selectedDetail.credits.version?.trim() || t('ui.notProvided') }}</dd>
              </div>
              <div>
                 <dt>{{ t('ui.fileSize') }}</dt>
                <dd>{{ fileSize(selectedDetail.fileSize) }}</dd>
              </div>
              <div>
                 <dt>{{ t('ui.glyphs') }}</dt>
                 <dd>{{ selectedDetail.glyphCount ?? t('ui.commonUnknown') }}</dd>
              </div>
              <div>
                 <dt>{{ t('ui.modified') }}</dt>
                <dd>{{ formatTimestamp(selectedDetail.modifiedAt) }}</dd>
              </div>
              <div>
                 <dt>{{ t('ui.fontFile') }}</dt>
                <dd
                  class="detail-path detail-path--action"
                  :data-face-id="selectedDetail.id"
                   :data-tooltip="`${selectedDetail.path}\n${t('ui.doubleClickToOpenTheFileRightClickToOpenItsFolder')}`"
                  @dblclick.stop="openFontFile"
                >{{ selectedDetail.path }}</dd>
              </div>
            </dl>
          </DetailSection>

          <DetailSection v-else-if="sectionId === 'style'" v-model:open="openSections.style" :title="t('ui.styleAttributes')">
            <dl class="detail-list">
              <div v-for="row in styleRows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
          </DetailSection>

          <DetailSection v-else-if="sectionId === 'metrics'" v-model:open="openSections.metrics" :title="t('ui.metrics')">
            <dl class="detail-list">
              <div v-for="row in metricRows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
          </DetailSection>

          <DetailSection v-else-if="sectionId === 'credits'" v-model:open="openSections.credits" :title="t('ui.copyrightAndVendor')">
            <dl class="detail-list detail-list--credits">
              <div v-for="row in creditRows" :key="row.label" :class="{ 'detail-list-item--wide': row.multiline }">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
          </DetailSection>

          <DetailSection v-else-if="sectionId === 'features'" v-model:open="openSections.features" :title="t('ui.opentypeFeatures')">
            <div v-if="selectedDetail.openTypeFeatures.length" class="feature-list">
              <div v-for="feature in selectedDetail.openTypeFeatures" :key="feature.tag">
                <strong>{{ feature.tag }}</strong>
                <span>{{ feature.name }}</span>
              </div>
            </div>
             <p v-else class="muted">{{ t('ui.thisFontDeclaresNoAvailableOpentypeFeatures') }}</p>
          </DetailSection>

          <DetailSection v-else-if="sectionId === 'axes'" v-model:open="openSections.axes" :title="t('ui.variationAxes')">
            <div class="axis-list">
              <div v-for="axis in selectedDetail.axes" :key="axis.tag">
                <strong>{{ axis.tag }}</strong>
                <span>{{ axis.name }}</span>
                 <small>{{ axis.min }} - {{ axis.max }} {{ t('ui.commonDefault') }} {{ axis.default }}</small>
              </div>
            </div>
          </DetailSection>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.muted {
  color: var(--ink-5);
}

.detail-sections {
  --cols: 1;
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

.detail-sections-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

@media (min-width: 1180px) {
  .detail-panel--parameters .detail-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1580px) {
  .detail-panel--parameters .detail-list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .detail-panel--parameters .feature-list {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }
}

.detail-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-white);
}

.detail-list div {
  min-width: 0;
  margin: 0 -1px -1px 0;
  padding: 12px 14px;
  background: var(--bg-white);
}

.detail-list dt {
  margin-bottom: 4px;
  color: var(--ink-5);
  font-size: 14px;
}

.detail-list dd {
  margin: 0;
  overflow: visible;
  color: var(--ink-2);
  font-size: 14px;
  overflow-wrap: anywhere;
  white-space: normal;
  user-select: text;
}

.detail-list .detail-path {
  font-size: 14px;
}

.detail-list .detail-path--action {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
  transition: color var(--ease), text-decoration-color var(--ease);
}

.detail-list .detail-path--action:hover {
  color: var(--accent-ink);
  text-decoration-color: currentColor;
}

.detail-list--credits,
.detail-panel--parameters .detail-list--credits {
  grid-template-columns: minmax(0, 1fr);
}

.feature-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.feature-list div {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-soft);
}

.feature-list strong {
  color: var(--accent-ink);
  font-family: var(--mono);
  font-size: 14px;
  font-weight: 700;
}

.feature-list span {
  color: var(--ink-3);
  font-size: 14px;
  overflow-wrap: anywhere;
}

.localized-names {
  display: grid;
  grid-template-columns: max-content max-content minmax(0, 1fr);
  column-gap: 12px;
  overflow: visible;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.localized-names > div {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  column-gap: 12px;
  row-gap: 8px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--bg-white);
  font-size: 14px;
}

.localized-names > div:first-child {
  border-radius: 7px 7px 0 0;
}

.localized-names > div:last-child {
  border-bottom: 0;
  border-radius: 0 0 7px 7px;
}

.localized-names span {
  color: var(--ink-3);
}

.localized-names small {
  color: var(--ink-5);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.localized-names .localized-name-value {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--detail-strong);
  font: inherit;
  font-weight: 400;
  text-align: left;
  overflow-wrap: anywhere;
  white-space: normal;
  cursor: pointer;
  user-select: text;
}

.localized-names .localized-name-value:hover,
.localized-names .localized-name-value:focus-visible,
.localized-names .localized-name-value.is-copied {
  color: var(--accent-ink);
  outline: 0;
}

.axis-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.axis-list div {
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-white);
}

.axis-list strong,
.axis-list span,
.axis-list small {
  display: block;
}

.axis-list strong {
  color: var(--accent-ink);
  font-family: var(--mono);
  font-size: 14px;
}

.axis-list span {
  margin-top: 3px;
  font-size: 14px;
}

.axis-list small {
  margin-top: 6px;
  color: var(--ink-5);
  font-size: 14px;
}

@media (max-width: 620px) {
  .detail-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
