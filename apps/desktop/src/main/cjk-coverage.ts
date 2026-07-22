import gb2312Table from './cjk-tables/gb2312.json'
import changyong3500Table from './cjk-tables/3500changyong.json'
import tongyong7000Table from './cjk-tables/7000tongyong.json'
import yiwuJiaoyuTable from './cjk-tables/yiwu-jiaoyu.json'
import tongyongGuifanTable from './cjk-tables/tongyong-guifan.json'
import hanyiJianfanTable from './cjk-tables/hanyi-jianfan.json'
import fangzhengJianfanTable from './cjk-tables/fangzheng-jianfan.json'
import iicoreTable from './cjk-tables/iicore.json'
import changyong4808Table from './cjk-tables/4808changyong.json'
import cichangyong6343Table from './cjk-tables/6343cichangyong.json'
import big5Table from './cjk-tables/big5.json'
import big5changyongTable from './cjk-tables/big5changyong.json'
import jf7000CoreTable from './cjk-tables/jf7000-core.json'
import hkchangyongTable from './cjk-tables/hkchangyong.json'
import hkscsTable from './cjk-tables/hkscs.json'
import suppcharaTable from './cjk-tables/suppchara.json'
import gb12345Table from './cjk-tables/gb12345.json'
import gujiyinshuaTable from './cjk-tables/gujiyinshua.json'

export type CjkGroup = string

export function getCjkCharsetCodePoints(id: string): { name: string; codePoints: number[] } | null {
  if (id === 'gbk') {
    const points: number[] = [0x3007]
    for (let cp = 0x4e00; cp <= 0x9fa5; cp++) points.push(cp)
    points.push(...GBK_COMPAT)
    return { name: 'charset.gbk', codePoints: points }
  }
  if (id === 'gb18030') {
    const points: number[] = []
    for (const [start, end] of gb18030Ranges()) {
      for (let cp = start; cp <= end; cp++) points.push(cp)
    }
    return { name: 'charset.gb18030', codePoints: points }
  }
  const table = tableSets.find(item => item.id === id)
  if (!table) return null
  return { name: table.name, codePoints: [...table.set].sort((a, b) => a - b) }
}

export function getCjkUnicodeBlockCodePoints(id: string): { name: string; codePoints: number[] } | null {
  const block = CJK_UNICODE_BLOCKS.find(item => item.id === id)
  if (!block) return null
  const points: number[] = []
  for (const [start, end] of block.ranges) {
    for (let cp = start; cp <= end; cp++) points.push(cp)
  }
  return { name: block.name, codePoints: points }
}

export interface CjkCoverageItem {
  id: string
  name: string
  group: CjkGroup
  codePointCount: number
  total: number
}

interface TableDef {
  id: string
  group: string
  name: string
  codePoints: number[]
}

/** Display group -> sort order. Lower comes first. */
const GROUP_ORDER: Record<string, number> = {
  'charsetGroup.simplifiedChinese': 0,
  'charsetGroup.simplifiedAndTraditional': 1,
  'charsetGroup.traditionalChinese': 2,
  'charsetGroup.japanese': 3,
  'charsetGroup.korean': 4,
  'charsetGroup.unicodeBlocks': 5,
}
const UNICODE_GROUP = 'charsetGroup.unicodeBlocks'

const CJK_COMPAT_UNIFIED = [
  0xfa0e, 0xfa0f, 0xfa11, 0xfa13, 0xfa14, 0xfa1f, 0xfa21, 0xfa23, 0xfa24, 0xfa27, 0xfa28, 0xfa29,
]

const GBK_COMPAT = [
  ...CJK_COMPAT_UNIFIED,
  0xf92c, 0xf979, 0xf995, 0xf9e7, 0xf9f1, 0xfa0c, 0xfa0d, 0xfa18, 0xfa20,
]

/** CJK-focused Unicode blocks shown in 汉字统计 view (totals use assigned spans where known). */
const CJK_UNICODE_BLOCKS: Array<{ id: string; name: string; ranges: Array<[number, number]> }> = [
  { id: 'kangxi', name: 'unicodeBlock.kangxiRadicals', ranges: [[0x2f00, 0x2fd5]] },
  { id: 'cjk-radicals-supplement', name: 'unicodeBlock.cjkRadicalsSupplement', ranges: [[0x2e80, 0x2ef3]] },
  { id: 'zero', name: '〇', ranges: [[0x3007, 0x3007]] },
  { id: 'cjk-unified', name: 'unicodeBlock.cjkUnifiedIdeographs', ranges: [[0x4e00, 0x9fff]] },
  { id: 'cjk-ext-a', name: 'unicodeBlock.cjkUnifiedIdeographsExtensionA', ranges: [[0x3400, 0x4dbf]] },
  { id: 'cjk-compat-unified', name: 'unicodeBlock.nonCompatibilityUnifiedIdeographs', ranges: CJK_COMPAT_UNIFIED.map(cp => [cp, cp] as [number, number]) },
  { id: 'cjk-compat', name: 'unicodeBlock.cjkCompatibilityIdeographs', ranges: [[0xf900, 0xfa6d], [0xfa70, 0xfad9]] },
  { id: 'cjk-ext-b', name: 'unicodeBlock.cjkUnifiedIdeographsExtensionB', ranges: [[0x20000, 0x2a6df]] },
  { id: 'cjk-ext-c', name: 'unicodeBlock.cjkUnifiedIdeographsExtensionC', ranges: [[0x2a700, 0x2b739]] },
  { id: 'cjk-ext-d', name: 'unicodeBlock.cjkUnifiedIdeographsExtensionD', ranges: [[0x2b740, 0x2b81d]] },
  { id: 'cjk-ext-e', name: 'unicodeBlock.cjkUnifiedIdeographsExtensionE', ranges: [[0x2b820, 0x2cea1]] },
  { id: 'cjk-ext-f', name: 'unicodeBlock.cjkUnifiedIdeographsExtensionF', ranges: [[0x2ceb0, 0x2ebe0]] },
  { id: 'cjk-ext-i', name: 'unicodeBlock.cjkUnifiedIdeographsExtensionI', ranges: [[0x2ebf0, 0x2ee5d]] },
  { id: 'cjk-compat-supplement', name: 'unicodeBlock.cjkCompatibilityIdeographsSupplement', ranges: [[0x2f800, 0x2fa1d]] },
  { id: 'cjk-ext-g', name: 'unicodeBlock.cjkUnifiedIdeographsExtensionG', ranges: [[0x30000, 0x3134a]] },
  { id: 'cjk-ext-h', name: 'unicodeBlock.cjkUnifiedIdeographsExtensionH', ranges: [[0x31350, 0x323af]] },
  { id: 'cjk-ext-j', name: 'unicodeBlock.cjkUnifiedIdeographsExtensionJ', ranges: [[0x323b0, 0x33479]] },
]

const tableModules = import.meta.glob<TableDef>('./cjk-tables/*.json', { eager: true })
const tableDefs = Object.values(tableModules)
const tableSets = tableDefs.map(table => ({
  id: table.id,
  group: table.group,
  name: table.name,
  total: table.codePoints.length,
  set: new Set(table.codePoints),
}))

function rangeTotal(ranges: Array<[number, number]>) {
  let total = 0
  for (const [start, end] of ranges) total += end - start + 1
  return total
}

function countInRanges(points: number[], ranges: Array<[number, number]>) {
  let count = 0
  for (const point of points) {
    for (const [start, end] of ranges) {
      if (point >= start && point <= end) {
        count++
        break
      }
    }
  }
  return count
}

function countGbk(points: number[]) {
  const compat = new Set(GBK_COMPAT)
  let count = 0
  for (const point of points) {
    if (point === 0x3007 || (point >= 0x4e00 && point <= 0x9fa5) || compat.has(point)) count++
  }
  return count
}

function gbkTotal() {
  return 1 + (0x9fa5 - 0x4e00 + 1) + GBK_COMPAT.length
}

function gb18030Ranges(): Array<[number, number]> {
  return [
    [0x3007, 0x3007],
    [0x4e00, 0x9fff],
    [0x3400, 0x4dbf],
    ...CJK_COMPAT_UNIFIED.map(cp => [cp, cp] as [number, number]),
  ]
}

export function computeCjkCoverage(characterSet: Iterable<number>): CjkCoverageItem[] {
  const points = Array.from(characterSet)
  const pointSet = new Set(points)
  const items: CjkCoverageItem[] = []

  for (const table of tableSets) {
    let count = 0
    for (const cp of table.set) {
      if (pointSet.has(cp)) count++
    }
    items.push({
      id: table.id,
      name: table.name,
      group: table.group,
      codePointCount: count,
      total: table.total,
    })
  }

  items.push({
    id: 'gbk',
    name: 'charset.gbk',
    group: 'charsetGroup.simplifiedAndTraditional',
    codePointCount: countGbk(points),
    total: gbkTotal(),
  })

  const gb18030 = gb18030Ranges()
  items.push({
    id: 'gb18030',
    name: 'charset.gb18030',
    group: 'charsetGroup.simplifiedAndTraditional',
    codePointCount: countInRanges(points, gb18030),
    total: rangeTotal(gb18030),
  })

  // Keep 简繁通用编码 order: file tables first, then gbk / gb18030
  const jianfanOrder = ['hanyi-jianfan', 'fangzheng-jianfan', 'iicore', 'gbk', 'gb18030']
  items.sort((a, b) => {
    const ao = GROUP_ORDER[a.group] ?? 99
    const bo = GROUP_ORDER[b.group] ?? 99
    if (ao !== bo) return ao - bo
    if (a.group === 'charsetGroup.simplifiedAndTraditional') {
      return jianfanOrder.indexOf(a.id) - jianfanOrder.indexOf(b.id)
    }
    return 0
  })

  for (const block of CJK_UNICODE_BLOCKS) {
    items.push({
      id: block.id,
      name: block.name,
      group: UNICODE_GROUP,
      codePointCount: countInRanges(points, block.ranges),
      total: rangeTotal(block.ranges),
    })
  }

  return items
}

/** Count of CJK-related code points present in the font (union of CJK unicode blocks). */
export function countCjkCharacters(characterSet: Iterable<number>): number {
  const points = Array.from(characterSet)
  let total = 0
  for (const block of CJK_UNICODE_BLOCKS) {
    total += countInRanges(points, block.ranges)
  }
  return total
}

export type { InferredLanguage } from '@fontral/font-indexer'
export { inferFontLanguage } from '@fontral/font-indexer'
