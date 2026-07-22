import { describe, expect, it } from 'vitest'
import tablesJson from './cjk-tables/tables.json'
import jisLevel1Table from './cjk-tables/jis-lv1.json'
import jisLevel2Table from './cjk-tables/jis-lv2.json'
import ksx1001Table from './cjk-tables/ksx1001.json'
import { inferFontLanguage } from './infer-language'

const tables = new Map(tablesJson.tables.map(table => [table.id, table.codePoints]))
const gb2312 = tables.get('gb2312')!
const big5 = tables.get('big5')!
const japaneseBase = [...new Set([...jisLevel1Table.codePoints, ...jisLevel2Table.codePoints])]
const ksx1001 = ksx1001Table.codePoints
const broadChineseCoverage = [...new Set([...gb2312, ...big5])]

describe('inferFontLanguage', () => {
  it('classifies Chinese by GB2312 and Big5 coverage rather than font names', () => {
    expect(inferFontLanguage(broadChineseCoverage, { names: ['Sarasa Gothic SC'] })).toBe('fontLanguage.simplifiedAndTraditionalChinese')
    expect(inferFontLanguage(gb2312, { names: ['Traditional Chinese'] })).toBe('fontLanguage.simplifiedChinese')
  })

  it('classifies Japanese and Korean by their base character-set coverage', () => {
    expect(inferFontLanguage(japaneseBase)).toBe('fontLanguage.japanese')
    expect(inferFontLanguage(ksx1001)).toBe('fontLanguage.korean')
  })

  it('does not mistake broad Big5 coverage for Japanese', () => {
    expect(inferFontLanguage(big5)).toBe('fontLanguage.traditionalChinese')
  })

  it('does not use JIS coverage to turn a Chinese font into Japanese', () => {
    expect(inferFontLanguage([...gb2312, ...japaneseBase])).toBe('fontLanguage.simplifiedChinese')
  })

  it('classifies non-Latin fonts without sufficient CJK coverage as other', () => {
    expect(inferFontLanguage([0x0370, 0x0371, 0x0372])).toBe('fontLanguage.other')
  })
})
